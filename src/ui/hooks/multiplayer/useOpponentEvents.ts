import { useEffect, useRef, type RefObject } from "react";
import { CARDS_PER_HAND } from "../../../engine/constants";
import { getAutoPlaceIndex, getLegalHands, isFaceDownPlacement } from "../../../engine/placement";
import type { GameEvent, GameState } from "../../../engine/types";
import { recordHiddenDraw } from "../../../crypto/protocolController";
import { DEAL_SLOTS, isFaceDownDraw, replaceDrawIndex, validReplaceHand } from "../../../crypto/drawSchedule";
import { subscribeToEvents } from "../../../net/sync";
import type { MultiplayerCtx } from "./context";
import { commitOwnFaceDownCard } from "./myMoves";

// Bound on waiting for MY OWN position reveal to land before falling back to
// a literal card-less TIMEOUT_HIDDEN for my own hidden turn (see
// handleTimeout) — an ordinary async round trip, not tied
// to the 60s timeout window, so a few short retries cover it comfortably.
const MAX_OWN_HIDDEN_TIMEOUT_RETRIES = 3;
const OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS = 300;

/** One logged event (with its push key and position) not yet applied locally. */
export type Queued = { key: string; seq: number; event: GameEvent };
/** The not-yet-applied events, sorted by `seq`; handlers inspect only the head. */
type Queue = RefObject<Queued[]>;
export type Deadline = RefObject<{ drawIndex: number; at: number } | null>;
type TimeoutEvent = Extract<GameEvent, { type: "TIMEOUT" | "TIMEOUT_HIDDEN" }>;
type ForfeitEvent = Extract<GameEvent, { type: "FORFEIT" }>;
type EndTurnEvent = Extract<GameEvent, { type: "END_TURN" }>;
type ReplaceEvent = Extract<GameEvent, { type: "REPLACE" }>;

/**
 * Subscription intake, key-deduped: every event in the log is queued exactly
 * once, whoever authored it. A key already in `seen` is either a duplicate
 * delivery or my own live write (registered before publishing, applied
 * locally on the ack), so it is skipped. Delivery order is not the game order
 * (push keys follow each client's own clock), so the queue is kept sorted by
 * `seq`, the rules-enforced position. Every published event carries `by` (the
 * rules require it); anything else is dropped as malformed. Returns true when
 * the event was queued.
 */
export function enqueueOnce(seen: Set<string>, queue: Queued[], event: GameEvent, key: string, seq: number): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (!("by" in event)) return false;
  const at = queue.findIndex((q) => q.seq > seq);
  queue.splice(at === -1 ? queue.length : at, 0, { key, seq, event });
  return true;
}

/**
 * Event intake: the Firebase subscription feeding a FIFO queue, and the effect
 * that applies (shift + dispatch), waits on (leave queued), or rejects
 * (shift + violation) the head of that queue. The log is the source of truth:
 * on mount the subscription replays the whole history through the same queue,
 * so a fresh instance rebuilds my own moves too (catch-up).
 */
export function useOpponentEvents(ctx: MultiplayerCtx): void {
  const { db, roomId, bumpTick, refs } = ctx;
  const queue = useRef<Queued[]>([]);
  // Bounded wait for the "my own position reveal hasn't landed yet" branch
  // of handleTimeout: a wall-clock deadline (NOT a per-effect-run
  // counter — the intake effect has no dependency array and can rerun many
  // times within the same millisecond as unrelated state settles, which would
  // exhaust a naive invocation counter almost instantly regardless of real
  // elapsed time). Reset whenever the draw index it's tracking changes.
  const ownHiddenTimeoutDeadline = useRef<{ drawIndex: number; at: number } | null>(null);

  // ONE subscription for the game's lifetime; `onChildAdded` replays history
  // and echoes my own writes, both deduped by push key in enqueueOnce.
  useEffect(
    () => {
      if (!roomId) return; // solo: no room, no listener
      return subscribeToEvents(db, roomId, (event, key, seq) => {
        if (enqueueOnce(refs.seenKeys.current, queue.current, event, key, seq)) bumpTick();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpTick only touches state setters and a ref, refs are stable; deps unchanged from the pre-split hook
    [db, roomId],
  );

  // Apply the head of the queue, at most one event per run; the dispatch
  // re-renders, which re-runs this effect for the next one. No dep array: it
  // must re-check after every render/tick, since the card an END_TURN waits on
  // can resolve after the event itself arrived.
  // Failed own-hidden-timeout commits so far (bounded retry, see handleTimeout).
  const translationFailures = useRef(0);
  useEffect(() => applyHead(ctx, queue, ownHiddenTimeoutDeadline, translationFailures));
}

/**
 * Applies, waits on or rejects the queue head, strictly in `seq` order: only
 * the event at `lastSeq + 1` is handled; a later one waits for the gap to
 * fill. Author: END_TURN/REPLACE are written by `by`; TIMEOUT/TIMEOUT_HIDDEN/
 * FORFEIT name the AFFECTED player in `by` and are written by the other seat
 * (the rules enforce both). Skipped while an earlier effect of this commit has
 * dispatched (stale `state`); the re-render re-runs it. Nothing is applied
 * before the local DEAL: it is derived from the reveal log, not an event, and
 * every logged event follows it (on a refresh the events can arrive first).
 */
export function applyHead(
  ctx: MultiplayerCtx,
  queue: Queue,
  deadline: Deadline,
  failures: RefObject<number> = { current: 0 },
): void {
  if (!ctx.role || ctx.hasPendingDispatch() || ctx.state.drawCount < DEAL_SLOTS.length) return;
  const head = queue.current[0];
  if (!head) return;
  const { lastSeq } = ctx.refs;
  if (head.seq <= lastSeq.current) {
    // A second event at an already-applied position. My own moves never get
    // here (their keys are in seenKeys), and the rules give each counter value
    // one event per update; but one update can carry two events with the same
    // seq, so this is a protocol violation, not a benign duplicate.
    reject(ctx, queue, `event ${head.key} at seq ${head.seq} repeats an already-applied position (last ${lastSeq.current})`);
    ctx.bumpTick();
    return;
  }
  if (head.seq > lastSeq.current + 1) return; // gap: wait for the missing event
  dispatchHead(ctx, queue, deadline, failures, head.event);
  if (queue.current[0] !== head) lastSeq.current = head.seq; // consumed (applied or rejected)
}

function dispatchHead(ctx: MultiplayerCtx, queue: Queue, deadline: Deadline, failures: RefObject<number>, event: GameEvent): void {
  if (event.type === "REPLACE") {
    handleReplace(ctx, queue, event);
  } else if (event.type === "TIMEOUT" || event.type === "TIMEOUT_HIDDEN") {
    handleTimeout(ctx, queue, deadline, failures, event);
  } else if (event.type === "END_TURN") {
    handleEndTurn(ctx, queue, event);
  } else if (event.type === "FORFEIT") {
    handleForfeit(ctx, queue, event);
  } else {
    // Deliberate FIFO blocking: other event types are never published by
    // this client. They stall the queue, so say so once instead of hanging
    // silently.
    ctx.warnOnce(`blocked:${event.type}`, `event ${event.type} is not handled; queue blocked`);
  }
}

/** Drops the head and records why (a protocol violation). */
function reject(ctx: MultiplayerCtx, queue: Queue, message: string): void {
  console.warn(`[useMultiplayerGame] ${message}`);
  queue.current.shift();
  ctx.recordViolation(message);
}

function handleReplace(ctx: MultiplayerCtx, queue: Queue, event: ReplaceEvent): void {
  const { you, role, state, dispatch, updateProtocol, refs } = ctx;
  const { by } = event;
  const who = by === you ? "own" : "opponent";
  // Still catching up to the end of the placing phase: wait, don't drop.
  if (state.phase === "placing") return;
  if (state.phase !== "replace" || state.turn !== by) {
    return reject(ctx, queue, `dropped ${who} REPLACE: local phase "${state.phase}", turn ${state.turn}, expected turn ${by}`);
  }
  const handIndex = validReplaceHand(event.handIndex);
  if (handIndex === "invalid") return reject(ctx, queue, `${who} REPLACE has invalid handIndex ${String(event.handIndex)}`);
  if (handIndex !== null && state.hands[by][handIndex].cards[CARDS_PER_HAND - 1]?.faceUp !== false) {
    return reject(ctx, queue, `${who} REPLACE targets hand ${handIndex} without a face-down 5th card`);
  }
  if (by !== you && role === "selector") {
    // Opponent is the dealer: its replace draw is secret (REPLACE_HIDDEN).
    if (state.pendingCard !== null || state.drawCount !== replaceDrawIndex(by)) {
      return reject(ctx, queue, `opponent REPLACE disagrees with local draw state (draw ${state.drawCount})`);
    }
    queue.current.shift();
    if (handIndex !== null) {
      const drawIndex = state.drawCount;
      updateProtocol("hidden swap draw", (cur) => recordHiddenDraw(cur, handIndex, drawIndex));
    }
    dispatch({ type: "REPLACE_HIDDEN", by, handIndex });
    return;
  }
  // The selector's REPLACE, or my own (catch-up): wait for the REPLACE_DRAW
  // (my own secret one, as dealer, resolves from my deck), then apply.
  if (state.pendingCard === null) return;
  const drawIndex = state.drawCount - 1;
  if (drawIndex !== replaceDrawIndex(by)) {
    return reject(ctx, queue, `${who} REPLACE disagrees with local draw index (draw ${drawIndex})`);
  }
  queue.current.shift();
  dispatch({ type: "REPLACE", by, handIndex });
  // My own hidden swap: rebuild the bookkeeping the live path recorded (its
  // placementCommit is already in the log, so nothing is published).
  if (by === you && role === "dealer" && handIndex !== null) refs.ownSlotDraw.current.set(handIndex, drawIndex);
}

function handleTimeout(
  ctx: MultiplayerCtx,
  queue: Queue,
  deadline: Deadline,
  failures: RefObject<number>,
  event: TimeoutEvent,
): void {
  const { you, state, dispatch, bumpTick, recordViolation, refs } = ctx;
  const { placedForDraw, timedOutOwnHiddenForDraw } = refs;
  // Self-contained (TIMEOUT carries its own card; TIMEOUT_HIDDEN carries
  // none by design), so — unlike END_TURN — there's no local pendingCard
  // to wait on in the general case. Still wait for local state to catch up
  // to the turn this reports, same readiness gate as END_TURN. Trusted as-is:
  // TIMEOUT always carries a card the sender legitimately had, and
  // TIMEOUT_HIDDEN needs no cross-check beyond the turn match already
  // required to apply it. `by` is the timed-out player; when it is NOT me, I
  // wrote this event (catch-up) and it applies as written.
  if (state.phase !== "placing" || state.turn !== event.by) return;
  if (event.type === "TIMEOUT_HIDDEN" && event.by === you) {
    // The one case that reports MY OWN turn: only the
    // non-active player may write TIMEOUT_HIDDEN, so this is the
    // opponent telling me MY hidden turn timed out. Unlike the selector
    // (who never learns this card), I'm the dealer here — the same
    // isFaceDownDraw-derived asymmetry `timeout()` uses — and I already
    // know my own secret card via the normal per-turn draw effect once
    // its position reveal lands, virtually always well before a 60s
    // timeout. Applying the literal card-less TIMEOUT_HIDDEN here would
    // both discard a card I already hold AND violate the reducer's own
    // precondition (it asserts no card is pending). So translate to the
    // real TIMEOUT locally with my known card — same asymmetric-by-role
    // translation already used in handleEndTurn for an opponent's
    // face-down END_TURN -> PLACE_HIDDEN — and commit it exactly like
    // `placePending` would have, so the reveal-phase batch can still name and bind it.
    if (state.pendingCard === null) {
      // My own position reveal hasn't landed yet either — an ordinary
      // async round trip, not tied to the 60s timeout window, so this is
      // a normal "hasn't arrived on THIS render" event, not proof nobody
      // will ever know the card. Wait up to a bounded deadline (same
      // shape as the reveal-batch publish retry in useRevealPhase) before
      // accepting defeat: only once it passes do I fall back to the
      // literal card-less TIMEOUT_HIDDEN, at which point I genuinely
      // know no more than the selector does.
      //
      // The bound is wall-clock time, not a per-effect-run counter: the
      // intake effect has no dependency array and can rerun many times within
      // the same millisecond as unrelated state settles (e.g. right
      // after the turn flips), which would exhaust a naive invocation
      // counter almost instantly regardless of how much real time has
      // actually passed.
      const now = Date.now();
      if (deadline.current?.drawIndex !== state.drawCount) {
        deadline.current = {
          drawIndex: state.drawCount,
          at: now + MAX_OWN_HIDDEN_TIMEOUT_RETRIES * OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS,
        };
      }
      if (now < deadline.current.at) {
        setTimeout(bumpTick, OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS); // force a re-check
        return; // leave the event queued for the retry
      }
      queue.current.shift();
      dispatch(event);
      return;
    }
    // In flight: the head STAYS queued (nothing behind it may overtake it) and
    // this guard parks every re-run until the async commit settles.
    if (timedOutOwnHiddenForDraw.current === state.drawCount) return;
    // Cross-guard against a narrow race with placePending: if I already
    // (or concurrently) placed this same draw myself via the UI, don't
    // also commit+dispatch a translated TIMEOUT for it.
    if (placedForDraw.current === state.drawCount) return;
    const turnDraw = state.drawCount;
    timedOutOwnHiddenForDraw.current = turnDraw;
    const head = queue.current[0];
    const card = state.pendingCard;
    const handIndex = getAutoPlaceIndex(state.hands[you]);
    const drawIndex = turnDraw - 1;
    commitOwnFaceDownCard(ctx, handIndex, card, drawIndex).then(
      () => {
        // Consume the head only now, then apply: in log order, before
        // anything queued behind it.
        failures.current = 0;
        queue.current.shift();
        ctx.refs.lastSeq.current = head.seq;
        try {
          dispatch({ type: "TIMEOUT", by: event.by, card });
        } catch (err) {
          console.error("[useMultiplayerGame] local TIMEOUT (own hidden turn) rejected by reducer", err);
          recordViolation(
            `local TIMEOUT (own hidden turn) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      (err: unknown) => {
        // Transient (reveal-log read / commit publish): leave the head queued
        // and retry; only a persistent failure consumes it as a violation.
        console.error("[useMultiplayerGame] failed to commit own hidden-timeout card", err);
        failures.current += 1;
        timedOutOwnHiddenForDraw.current = null;
        if (failures.current < MAX_OWN_HIDDEN_TIMEOUT_RETRIES) {
          setTimeout(bumpTick, OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS);
          return;
        }
        failures.current = 0;
        queue.current.shift();
        ctx.refs.lastSeq.current = head.seq;
        recordViolation(
          `failed to commit own hidden-timeout card: ${err instanceof Error ? err.message : String(err)}`,
        );
        bumpTick();
      },
    );
    return;
  }
  queue.current.shift();
  if (event.type === "TIMEOUT_HIDDEN") {
    // The dealer's hidden turn auto-placed a card I never see: record its
    // hand and draw like a PLACE_HIDDEN, so the reveal batch can be checked.
    const handIndex = getAutoPlaceIndex(state.hands[event.by]);
    const drawIndex = state.drawCount;
    ctx.updateProtocol("hidden timeout draw", (cur) => recordHiddenDraw(cur, handIndex, drawIndex));
  }
  dispatch(event);
}

/**
 * Applies a FORFEIT: claimed by the opponent against me (I was disconnected),
 * or by me against the opponent (catch-up). Self-contained and valid from any
 * pre-result phase, so no readiness gate; if I'm already in "result" (reducer
 * would throw) it is just dropped.
 */
function handleForfeit(ctx: MultiplayerCtx, queue: Queue, event: ForfeitEvent): void {
  queue.current.shift();
  if (ctx.state.phase === "result") return;
  ctx.dispatch(event);
}

/** Why `event` contradicts the locally derived rules (draw index and fill-evenly), or null. */
function endTurnMismatch(state: GameState, event: EndTurnEvent, turnDrawIndex: number): string | null {
  const hands = state.hands[event.by];
  const legal = getLegalHands(hands).includes(event.handIndex);
  if (legal && event.faceDown === isFaceDownPlacement(hands[event.handIndex]) && event.faceDown === isFaceDownDraw(turnDrawIndex, event.by)) {
    return null;
  }
  return `END_TURN faceDown=${event.faceDown} disagrees with local rules (hand ${event.handIndex}, draw ${turnDrawIndex})`;
}

function handleEndTurn(ctx: MultiplayerCtx, queue: Queue, event: EndTurnEvent): void {
  const { you, role, state, dispatch, updateProtocol, refs } = ctx;
  if (state.phase !== "placing" || state.turn !== event.by) return;
  if (event.by === you) {
    // My own END_TURN found in the log (catch-up; live echoes are deduped by
    // key): wait for my card to resolve, cross-check, apply unchanged.
    if (state.pendingCard === null) return;
    const drawIndex = state.drawCount - 1;
    const mismatch = endTurnMismatch(state, event, drawIndex);
    if (mismatch) return reject(ctx, queue, `own ${mismatch}`);
    queue.current.shift();
    dispatch(event);
    // My own hidden placement: rebuild the bookkeeping the live path recorded
    // (its placementCommit is already in the log, so nothing is published).
    if (role === "dealer" && event.faceDown) refs.ownSlotDraw.current.set(event.handIndex, drawIndex);
    return;
  }
  // Never trust the remote faceDown flag: cross-check the locally derived
  // rules. Draw index of this turn's card:
  const turnDrawIndex = state.pendingCard !== null ? state.drawCount - 1 : state.drawCount;
  const mismatch = endTurnMismatch(state, event, turnDrawIndex);
  if (mismatch) return reject(ctx, queue, `opponent ${mismatch}`);
  if (role === "selector" && event.faceDown) {
    // Opponent is the dealer: I never learn this card before the reveal phase.
    if (state.pendingCard !== null) return;
    queue.current.shift();
    const hiddenDrawIndex = state.drawCount;
    updateProtocol("hidden placement draw", (cur) => recordHiddenDraw(cur, event.handIndex, hiddenDrawIndex));
    dispatch({ type: "PLACE_HIDDEN", by: event.by, handIndex: event.handIndex });
    return;
  }
  if (state.pendingCard === null) return; // card reveal chain not resolved yet
  queue.current.shift();
  dispatch(event);
}
