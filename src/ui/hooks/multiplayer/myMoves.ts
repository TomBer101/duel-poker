import { CARDS_PER_HAND } from "../../../engine/constants";
import { otherPlayer } from "../../../engine/deck";
import { getAutoPlaceIndex, isFaceDownPlacement } from "../../../engine/placement";
import type { Card, GameEvent, PlayerId } from "../../../engine/types";
import { derivePlacementSalt } from "../../../crypto/protocol";
import { commitPlacement, recordHiddenDraw } from "../../../crypto/protocolController";
import { DEAL_SLOTS, isFaceDownDraw, validReplaceHand } from "../../../crypto/drawSchedule";
import { fetchReveals, newEventKey, publishEvent, publishReveal } from "../../../net/sync";
import { publishRematchVote, publishTurnStarted } from "../../../net/roomState";
import type { MultiplayerCtx } from "./context";

// My own moves: plain functions over the render's ctx (no effects). Each reads
// the `state` snapshot of the render that built `ctx`, exactly like the
// closures they were before the split. Each returns a promise that settles
// once the move is applied or abandoned, and never rejects.

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Publish-then-apply: the event log is the source of truth, so my move is
 * applied locally only once the server accepted it. It is published at
 * `seq = lastSeq + 1` (the next position after everything applied locally):
 * the rules accept exactly one event per position, so a move made on a state
 * that is behind the log (e.g. my END_TURN racing the opponent's TIMEOUT
 * report) is denied rather than applied out of order. The key is registered
 * as seen BEFORE the write (Firebase raises optimistic local events, so the
 * echo can arrive before the ack) and the intake skips it. A rejected write
 * leaves local state untouched and is abandoned, not a violation (it is a
 * legitimate race); the caller clears its in-flight guard so the user / timer
 * can act again on the caught-up state. Returns true when applied.
 */
async function publishThenApply(ctx: MultiplayerCtx, event: GameEvent, nextTurn?: PlayerId): Promise<boolean> {
  const { db, roomId, dispatch, recordViolation, refs } = ctx;
  const key = newEventKey(db, roomId);
  const seq = refs.lastSeq.current + 1;
  refs.seenKeys.current.add(key);
  try {
    await publishEvent(db, roomId, event, { seq, nextTurn, key });
  } catch (err) {
    console.warn(`[useMultiplayerGame] ${event.type} (seq ${seq}) was not accepted; local state unchanged`, err);
    ctx.bumpTick(); // re-check the queue now (a head may be parked on my in-flight guard)
    return false;
  }
  // Position `seq` is mine: the intake (which skips my key) moves past it.
  refs.lastSeq.current = seq;
  try {
    dispatch(event);
  } catch (err) {
    // Already on the wire: a reducer throw here is a protocol-level failure.
    console.error(`[useMultiplayerGame] local ${event.type} rejected by reducer`, err);
    recordViolation(`local ${event.type} failed: ${errText(err)}`);
    return false;
  }
  return true;
}

function startTurnClock(ctx: MultiplayerCtx): Promise<void> {
  return publishTurnStarted(ctx.db, ctx.roomId).catch((err: unknown) => {
    console.error("[useMultiplayerGame] failed to publish turn start", err);
  });
}

/** Dealer-only: the (seed-deterministic) placement commitment for a known face-down card. */
async function placementCommitment(ctx: MultiplayerCtx, handIndex: number, card: Card, drawIndex: number): Promise<string> {
  const dealer = ctx.dealerState.current;
  if (!dealer) {
    // Callers only get here as the dealer, after the deal: my shuffle state
    // must exist. Without it no commit can be made (callers treat the throw
    // as a failed commit).
    const message = `placement commit for hand ${handIndex} without my dealer state`;
    ctx.recordViolation(message);
    throw new Error(message);
  }
  const salt = await derivePlacementSalt(dealer.seed, handIndex, drawIndex);
  return commitPlacement(card, handIndex, salt);
}

/** Dealer-only: hashes and publishes a `placementCommit` for a known face-down card. */
async function publishPlacementCommit(ctx: MultiplayerCtx, handIndex: number, card: Card, drawIndex: number): Promise<void> {
  const { db, roomId, you } = ctx;
  const commitment = await placementCommitment(ctx, handIndex, card, drawIndex);
  await publishReveal(db, roomId, { kind: "placementCommit", by: you, handIndex, commitment });
}

/**
 * Dealer-only: commits a known face-down card at `handIndex` and records its
 * originating draw index so the reveal-phase batch (useRevealPhase) can later
 * name and bind it back to the deck commitment (its salt is re-derived
 * there). Used by the dealer-side translation of an opponent's TIMEOUT_HIDDEN
 * report (my own hidden turn, timed out), whose event is already in the log.
 * The commitment is deterministic, so on catch-up (a fresh instance replaying
 * the log) an identical one is usually already in the reveal log: it is then
 * NOT republished. A republished copy would become the hand's "latest" commit
 * and break the reveal check of a later swap into the same hand.
 */
export async function commitOwnFaceDownCard(
  ctx: MultiplayerCtx,
  handIndex: number,
  card: Card,
  drawIndex: number,
): Promise<void> {
  const { db, roomId, you } = ctx;
  const commitment = await placementCommitment(ctx, handIndex, card, drawIndex);
  const published = (await fetchReveals(db, roomId)).some(
    (r) => r.kind === "placementCommit" && r.by === you && r.handIndex === handIndex && r.commitment === commitment,
  );
  if (!published) await publishReveal(db, roomId, { kind: "placementCommit", by: you, handIndex, commitment });
  ctx.refs.ownSlotDraw.current.set(handIndex, drawIndex);
}

/** Replace my 5th card in `handIndex` with my pending replace draw, or pass (null). */
export async function replace(ctx: MultiplayerCtx, handIndex: number | null): Promise<void> {
  const { you, role, state, refs } = ctx;
  const { ownSlotDraw, replacedForDraw } = refs;
  const card = state.pendingCard;
  if (state.phase !== "replace" || state.turn !== you || !card) return;
  if (validReplaceHand(handIndex) === "invalid") return;
  // Validate locally BEFORE publishing any commit: a reducer throw after a
  // commit is already on the wire would leave an orphan placementCommit.
  if (handIndex !== null && state.hands[you][handIndex].cards[CARDS_PER_HAND - 1]?.faceUp !== false) return;
  if (replacedForDraw.current === state.drawCount) return; // already in flight
  replacedForDraw.current = state.drawCount;
  const slotDraw = state.drawCount - 1; // the draw this replacement card came from
  const lastReplacer = state.replaceDone[otherPlayer(you)];
  // A hidden swap needs a fresh commitment (latest per hand wins), published
  // before the event. The selector's cards are never hidden from the dealer,
  // so only the dealer commits.
  const hiddenSwap = role === "dealer" && handIndex !== null;
  if (hiddenSwap) {
    try {
      await publishPlacementCommit(ctx, handIndex, card, slotDraw);
    } catch (err) {
      console.error("[useMultiplayerGame] failed to commit replacement", err);
      replacedForDraw.current = null;
      ctx.bumpTick();
      return;
    }
  }
  if (!(await publishThenApply(ctx, { type: "REPLACE", by: you, handIndex }, otherPlayer(you)))) {
    replacedForDraw.current = null;
    return;
  }
  if (hiddenSwap) ownSlotDraw.current.set(handIndex, slotDraw);
  if (!lastReplacer) await startTurnClock(ctx);
}

/**
 * Reports the OPPONENT's turn as timed out (per spec, a player never
 * self-reports its own timeout, so this is a no-op on my own turn).
 * `useRemoteTimer` is the caller; this hook only owns the event
 * logic. Two cases, told apart by the SAME `isFaceDownDraw` derivation the
 * placement/draw effects already use:
 *  - known card: the opponent's card already resolved locally (into
 *    `state.pendingCard`, exactly like a normal turn) -> TIMEOUT.
 *  - hidden card: I'm the selector and the opponent (the dealer) is on its
 *    own face-down turn, the one case I can never learn the card before
 *    it's placed -> TIMEOUT_HIDDEN (card-less).
 * A safe no-op — never throws — whenever it's my own turn, we're not in
 * "placing", or (known-card case) the card hasn't resolved yet.
 */
export async function timeout(ctx: MultiplayerCtx): Promise<void> {
  const { you, role, state, refs } = ctx;
  const { timedOutForDraw } = refs;
  if (!role || state.phase !== "placing" || state.turn === you) return;
  const opponent = state.turn;
  const turnDrawIndex = state.pendingCard !== null ? state.drawCount - 1 : state.drawCount;
  const hidden = role === "selector" && isFaceDownDraw(turnDrawIndex, opponent);
  if (!hidden && state.pendingCard === null) return; // card not resolved yet: safe no-op
  if (timedOutForDraw.current === turnDrawIndex) return; // already in flight
  timedOutForDraw.current = turnDrawIndex;
  const event: GameEvent = hidden
    ? { type: "TIMEOUT_HIDDEN", by: opponent }
    : { type: "TIMEOUT", by: opponent, card: state.pendingCard! };
  if (!(await publishThenApply(ctx, event, you))) {
    timedOutForDraw.current = null;
    return;
  }
  if (hidden) {
    // The dealer's card went face-down unseen: record its hand and draw like a
    // PLACE_HIDDEN, so its reveal-phase batch entry can be checked.
    const handIndex = getAutoPlaceIndex(state.hands[opponent]);
    ctx.updateProtocol("hidden timeout draw", (cur) => recordHiddenDraw(cur, handIndex, turnDrawIndex));
  }
  await startTurnClock(ctx);
}

/**
 * Claims a win against a disconnected opponent: publishes, then applies, a
 * FORFEIT naming the OPPONENT (the forfeiting player). Trusted as-is: presence
 * is written by the opponent's own onDisconnect, not forgeable by the claimer.
 * No-op before the opening deal (every logged event must follow the DEAL, see
 * applyHead), while a claim is in flight, or once the game has a result.
 */
export async function claimWin(ctx: MultiplayerCtx): Promise<void> {
  const { you, role, state, refs } = ctx;
  if (!role || state.drawCount < DEAL_SLOTS.length || state.phase === "result" || refs.claimedWin.current) return;
  refs.claimedWin.current = true;
  if (!(await publishThenApply(ctx, { type: "FORFEIT", by: otherPlayer(you) }))) refs.claimedWin.current = false;
}

/**
 * Votes for a rematch. The rules don't tie votes to a game, so the client is
 * strict: only from this game's result screen, and once (a second click, or a
 * stale handle after the room reset, must never publish another vote).
 */
export function playAgain(ctx: MultiplayerCtx): void {
  const { db, roomId, you, state, refs } = ctx;
  if (state.phase !== "result" || refs.rematchVoted.current) return;
  refs.rematchVoted.current = true;
  publishRematchVote(db, roomId, you).catch((err: unknown) => {
    console.error("[useMultiplayerGame] failed to publish rematch vote", err);
    refs.rematchVoted.current = false; // nothing was recorded: allow a click-retry
  });
}

/**
 * Places my resolved pending card: hidden-placement commit (dealer), then the
 * END_TURN, applied locally once accepted (never throws).
 * `legalHands` is the root's render-time value (same snapshot as `ctx.state`).
 */
export async function placePending(ctx: MultiplayerCtx, legalHands: number[], handIndex: number): Promise<void> {
  const { you, role, state, warnOnce, refs } = ctx;
  const { ownSlotDraw, placedForDraw, timedOutOwnHiddenForDraw } = refs;
  const card = state.pendingCard;
  if (state.phase !== "placing" || state.turn !== you || !card) return;
  if (!legalHands.includes(handIndex)) return;
  if (placedForDraw.current === state.drawCount) return; // already in flight
  // Cross-guard against a narrow race with the intake queue's own-hidden-
  // timeout translation (handleTimeout in useOpponentEvents): if that
  // path already claimed this same draw, don't also publish a normal END_TURN
  // for it.
  if (timedOutOwnHiddenForDraw.current === state.drawCount) return;
  placedForDraw.current = state.drawCount;

  const faceDown = isFaceDownPlacement(state.hands[you][handIndex]);
  if (role === "dealer" && faceDown !== isFaceDownDraw(state.drawCount - 1, you)) {
    warnOnce(`own-facedown:${state.drawCount}`, `own placement faceDown=${faceDown} disagrees with draw-index rule (draw ${state.drawCount - 1})`);
  }
  const placingDraw = state.drawCount - 1; // the draw this placed card came from
  const hidden = role === "dealer" && faceDown;
  if (hidden) {
    try {
      await publishPlacementCommit(ctx, handIndex, card, placingDraw);
    } catch (err) {
      console.error("[useMultiplayerGame] failed to commit face-down placement", err);
      placedForDraw.current = null; // allow a retry
      ctx.bumpTick();
      return;
    }
  }
  if (!(await publishThenApply(ctx, { type: "END_TURN", by: you, handIndex, faceDown }, otherPlayer(you)))) {
    placedForDraw.current = null; // allow a retry
    return;
  }
  if (hidden) ownSlotDraw.current.set(handIndex, placingDraw);
  await startTurnClock(ctx);
}
