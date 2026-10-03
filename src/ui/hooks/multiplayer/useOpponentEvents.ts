import { useEffect, useRef, type RefObject } from "react";
import { CARDS_PER_HAND } from "../../../engine/constants";
import { getAutoPlaceIndex, getLegalHands, isFaceDownPlacement } from "../../../engine/placement";
import type { GameEvent, PlayerId } from "../../../engine/types";
import { recordHiddenDraw } from "../../../crypto/protocolController";
import { isFaceDownDraw, replaceDrawIndex, validReplaceHand } from "../../../crypto/drawSchedule";
import { subscribeToEvents } from "../../../net/sync";
import type { MultiplayerCtx } from "./context";
import { commitOwnFaceDownCard } from "./myMoves";

// Bound on waiting for MY OWN position reveal to land before falling back to
// a literal card-less TIMEOUT_HIDDEN for my own hidden turn (see
// handleOpponentTimeout) — an ordinary async round trip, not tied
// to the 60s timeout window, so a few short retries cover it comfortably.
const MAX_OWN_HIDDEN_TIMEOUT_RETRIES = 3;
const OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS = 300;

/** The opponent's not-yet-applied events (FIFO); handlers inspect only the head. */
type Queue = RefObject<GameEvent[]>;
type Deadline = RefObject<{ drawIndex: number; at: number } | null>;
type TimeoutEvent = Extract<GameEvent, { type: "TIMEOUT" | "TIMEOUT_HIDDEN" }>;
type EndTurnEvent = Extract<GameEvent, { type: "END_TURN" }>;

/**
 * Opponent event intake: the Firebase subscription feeding a FIFO queue, and
 * the effect that applies (shift + dispatch), waits on (leave queued), or
 * rejects (shift + violation) the head of that queue.
 */
export function useOpponentEvents(ctx: MultiplayerCtx): void {
  const { db, roomId, you, role, bumpTick, warnOnce } = ctx;
  const opponentEvents = useRef<GameEvent[]>([]);
  // Bounded wait for the "my own position reveal hasn't landed yet" branch
  // of handleOpponentTimeout: a wall-clock deadline (NOT a per-effect-run
  // counter — the intake effect has no dependency array and can rerun many
  // times within the same millisecond as unrelated state settles, which would
  // exhaust a naive invocation counter almost instantly regardless of real
  // elapsed time). Reset whenever the draw index it's tracking changes.
  const ownHiddenTimeoutDeadline = useRef<{ drawIndex: number; at: number } | null>(null);

  // Opponent event intake: ONE subscription for the game's lifetime.
  // `onChildAdded` also echoes my own writes (and replays history), so events
  // by me are ignored. Events with no `by` (REMATCH) belong to their own task.
  useEffect(
    () =>
      subscribeToEvents(db, roomId, (event) => {
        if (!("by" in event)) return;
        // Self-echo detection is inverted for TIMEOUT/TIMEOUT_HIDDEN: per spec
        // only the NON-active player writes them, so `event.by` names the
        // TIMED-OUT (active) player, not the sender. On the timed-out player's
        // own client `event.by === you`, yet that client never wrote it — the
        // opponent did, reporting on me — so it must NOT be treated as my own
        // echo. Every other event type still uses `event.by === you` as "I
        // sent this" (I only ever publish events about my own actions).
        const isOwnEcho =
          event.type === "TIMEOUT" || event.type === "TIMEOUT_HIDDEN" ? event.by !== you : event.by === you;
        if (isOwnEcho) return;
        opponentEvents.current.push(event);
        bumpTick();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpTick only touches state setters and a ref (stable in effect); deps unchanged from the pre-split hook
    [db, roomId, you],
  );

  // TODO(Task 14, refresh recovery): events replayed from history are not
  // deduped by push key; a remount resets every ref so this is latent today.

  // Apply the head of the opponent queue, at most one event per run; the
  // dispatch re-renders, which re-runs this effect for the next one. No dep
  // array: it must re-check after every render/tick, since the card an END_TURN
  // waits on can resolve after the event itself arrived.
  useEffect(() => {
    if (!role) return;
    const event = opponentEvents.current[0];
    if (!event) return;
    if (event.type === "REPLACE") {
      handleOpponentReplace(ctx, opponentEvents, event.by, event.handIndex);
    } else if (event.type === "TIMEOUT" || event.type === "TIMEOUT_HIDDEN") {
      handleOpponentTimeout(ctx, opponentEvents, ownHiddenTimeoutDeadline, event);
    } else if (event.type === "END_TURN") {
      handleOpponentEndTurn(ctx, opponentEvents, event);
    } else {
      // Deliberate FIFO blocking: other opponent events (rematch, etc.) are
      // handled by later tasks. Until then they stall the queue, so say so
      // once instead of hanging silently.
      warnOnce(`blocked:${event.type}`, `opponent event ${event.type} is not handled yet; queue blocked`);
    }
  });
}

function handleOpponentReplace(
  ctx: MultiplayerCtx,
  opponentEvents: Queue,
  by: PlayerId,
  rawHandIndex: number | null | undefined,
): void {
  const { role, state, dispatch, updateProtocol, recordViolation } = ctx;
  const fail = (message: string) => {
    console.warn(`[useMultiplayerGame] ${message}`);
    opponentEvents.current.shift();
    recordViolation(message);
  };
  // Still catching up to my own last dispatch: wait for it, don't drop.
  if (state.phase === "placing") return;
  if (state.phase !== "replace" || state.turn !== by) {
    return fail(`dropped opponent REPLACE: local phase "${state.phase}", turn ${state.turn}, expected turn ${by}`);
  }
  const handIndex = validReplaceHand(rawHandIndex);
  if (handIndex === "invalid") return fail(`opponent REPLACE has invalid handIndex ${String(rawHandIndex)}`);
  if (handIndex !== null && state.hands[by][handIndex].cards[CARDS_PER_HAND - 1]?.faceUp !== false) {
    return fail(`opponent REPLACE targets hand ${handIndex} without a face-down 5th card`);
  }
  if (role === "selector") {
    // Opponent is the dealer: its replace draw is secret (REPLACE_HIDDEN).
    if (state.pendingCard !== null || state.drawCount !== replaceDrawIndex(by)) {
      return fail(`opponent REPLACE disagrees with local draw state (draw ${state.drawCount})`);
    }
    opponentEvents.current.shift();
    if (handIndex !== null) {
      const drawIndex = state.drawCount;
      updateProtocol("hidden swap draw", (cur) => recordHiddenDraw(cur, handIndex, drawIndex));
    }
    dispatch({ type: "REPLACE_HIDDEN", by, handIndex });
    return;
  }
  // Opponent is the selector: wait for its REPLACE_DRAW to resolve, then apply.
  if (state.pendingCard === null) return;
  if (state.drawCount - 1 !== replaceDrawIndex(by)) {
    return fail(`opponent REPLACE disagrees with local draw index (draw ${state.drawCount - 1})`);
  }
  opponentEvents.current.shift();
  dispatch({ type: "REPLACE", by, handIndex });
}

function handleOpponentTimeout(
  ctx: MultiplayerCtx,
  opponentEvents: Queue,
  ownHiddenTimeoutDeadline: Deadline,
  event: TimeoutEvent,
): void {
  const { you, state, dispatch, bumpTick, recordViolation, refs } = ctx;
  const { placedForDraw, timedOutOwnHiddenForDraw } = refs;
  // Self-contained (TIMEOUT carries its own card; TIMEOUT_HIDDEN carries
  // none by design), so — unlike END_TURN — there's no local pendingCard
  // to wait on in the general case. Still wait for my own dispatch to
  // catch up to the turn this reports, same readiness gate as END_TURN
  // (handleOpponentEndTurn). Trusted as-is, like every other opponent event
  // applied in this queue: TIMEOUT always carries a card the sender legitimately
  // had, and TIMEOUT_HIDDEN needs no cross-check beyond the turn match
  // already required to apply it.
  if (state.phase !== "placing" || state.turn !== event.by) return;
  if (event.type === "TIMEOUT_HIDDEN" && event.by === you) {
    // The one case this queue ever reports MY OWN turn: only the
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
    // translation already used in handleOpponentEndTurn for an opponent's
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
      if (ownHiddenTimeoutDeadline.current?.drawIndex !== state.drawCount) {
        ownHiddenTimeoutDeadline.current = {
          drawIndex: state.drawCount,
          at: now + MAX_OWN_HIDDEN_TIMEOUT_RETRIES * OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS,
        };
      }
      if (now < ownHiddenTimeoutDeadline.current.at) {
        setTimeout(bumpTick, OWN_HIDDEN_TIMEOUT_RETRY_DELAY_MS); // force a re-check
        return; // leave the event queued for the retry
      }
      opponentEvents.current.shift();
      dispatch(event);
      return;
    }
    if (timedOutOwnHiddenForDraw.current === state.drawCount) return; // already in flight
    // Cross-guard against a narrow race with placePending: if I already
    // (or concurrently) placed this same draw myself via the UI, don't
    // also commit+dispatch a translated TIMEOUT for it.
    if (placedForDraw.current === state.drawCount) return;
    timedOutOwnHiddenForDraw.current = state.drawCount;
    opponentEvents.current.shift();
    const card = state.pendingCard;
    const handIndex = getAutoPlaceIndex(state.hands[you]);
    const drawIndex = state.drawCount - 1;
    commitOwnFaceDownCard(ctx, handIndex, card, drawIndex).then(
      () => {
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
        console.error("[useMultiplayerGame] failed to commit own hidden-timeout card", err);
        recordViolation(
          `failed to commit own hidden-timeout card: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
    return;
  }
  opponentEvents.current.shift();
  dispatch(event);
}

function handleOpponentEndTurn(ctx: MultiplayerCtx, opponentEvents: Queue, event: EndTurnEvent): void {
  const { role, state, dispatch, updateProtocol, recordViolation } = ctx;
  if (state.phase !== "placing" || state.turn !== event.by) return;
  // Never trust the remote faceDown flag: cross-check the locally derived
  // rules (draw index and fill-evenly). Draw index of this turn's card:
  const turnDrawIndex = state.pendingCard !== null ? state.drawCount - 1 : state.drawCount;
  const legal = getLegalHands(state.hands[event.by]);
  const expectedFaceDown =
    legal.includes(event.handIndex) && isFaceDownPlacement(state.hands[event.by][event.handIndex]);
  if (event.faceDown !== expectedFaceDown || event.faceDown !== isFaceDownDraw(turnDrawIndex, event.by)) {
    const message = `opponent END_TURN faceDown=${event.faceDown} disagrees with local rules (hand ${event.handIndex}, draw ${turnDrawIndex})`;
    console.warn(`[useMultiplayerGame] ${message}`);
    opponentEvents.current.shift();
    recordViolation(message);
    return;
  }
  if (role === "selector" && event.faceDown) {
    // Opponent is the dealer: I never learn this card before the reveal phase.
    if (state.pendingCard !== null) return;
    opponentEvents.current.shift();
    const hiddenDrawIndex = state.drawCount;
    updateProtocol("hidden placement draw", (cur) => recordHiddenDraw(cur, event.handIndex, hiddenDrawIndex));
    dispatch({ type: "PLACE_HIDDEN", by: event.by, handIndex: event.handIndex });
    return;
  }
  if (state.pendingCard === null) return; // card reveal chain not resolved yet
  opponentEvents.current.shift();
  dispatch(event);
}
