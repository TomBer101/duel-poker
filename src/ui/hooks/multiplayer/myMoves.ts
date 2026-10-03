import { CARDS_PER_HAND } from "../../../engine/constants";
import { otherPlayer } from "../../../engine/deck";
import { isFaceDownPlacement } from "../../../engine/placement";
import type { Card, GameEvent } from "../../../engine/types";
import { generateSalt } from "../../../crypto/commitment";
import { commitPlacement } from "../../../crypto/protocolController";
import { isFaceDownDraw, validReplaceHand } from "../../../crypto/drawSchedule";
import { publishEvent, publishReveal } from "../../../net/sync";
import { publishTurnStarted } from "../../../net/roomState";
import type { MultiplayerCtx } from "./context";

// My own moves: plain functions over the render's ctx (no effects). Each reads
// the `state` snapshot of the render that built `ctx`, exactly like the
// closures they were before the split.

/**
 * Dealer-only: hashes and publishes a `placementCommit` for a known
 * face-down card at `handIndex`, and records its salt and originating
 * draw index so the reveal-phase batch (useRevealPhase) can later name and
 * bind it back to the deck commitment. Same commit `placePending`/`replace`
 * publish for a self-initiated hidden placement/swap, factored out so the
 * dealer-side translation of an opponent's TIMEOUT_HIDDEN report (my own
 * hidden turn, timed out) can commit its card the same way.
 */
export async function commitOwnFaceDownCard(
  ctx: MultiplayerCtx,
  handIndex: number,
  card: Card,
  drawIndex: number,
): Promise<void> {
  const { db, roomId, you, refs } = ctx;
  const { pendingPlacementSalts, ownSlotDraw } = refs;
  const salt = generateSalt();
  const commitment = await commitPlacement(card, handIndex, salt);
  await publishReveal(db, roomId, { kind: "placementCommit", by: you, handIndex, commitment });
  pendingPlacementSalts.current.set(handIndex, salt);
  ownSlotDraw.current.set(handIndex, drawIndex);
}

/** Replace my 5th card in `handIndex` with my pending replace draw, or pass (null). */
export function replace(ctx: MultiplayerCtx, handIndex: number | null): void {
  const { db, roomId, you, role, state, dispatch, recordViolation, refs } = ctx;
  const { pendingPlacementSalts, ownSlotDraw, replacedForDraw } = refs;
  const card = state.pendingCard;
  if (state.phase !== "replace" || state.turn !== you || !card) return;
  if (validReplaceHand(handIndex) === "invalid") return;
  // Validate locally BEFORE publishing any commit: a reducer throw after a
  // commit is already on the wire would leave an orphan placementCommit.
  if (handIndex !== null && state.hands[you][handIndex].cards[CARDS_PER_HAND - 1]?.faceUp !== false) return;
  if (replacedForDraw.current === state.drawCount) return; // already in flight
  replacedForDraw.current = state.drawCount;
  const slotDraw = state.drawCount - 1; // the draw this replacement card came from
  const event: GameEvent = { type: "REPLACE", by: you, handIndex };
  const lastReplacer = state.replaceDone[otherPlayer(you)];
  const commitFirst = async () => {
    // A hidden swap needs a fresh commitment (latest per hand wins). The
    // selector's cards are never hidden from the dealer, so only the dealer commits.
    if (role !== "dealer" || handIndex === null) return;
    const salt = generateSalt();
    const commitment = await commitPlacement(card, handIndex, salt);
    await publishReveal(db, roomId, { kind: "placementCommit", by: you, handIndex, commitment });
    pendingPlacementSalts.current.set(handIndex, salt);
    ownSlotDraw.current.set(handIndex, slotDraw);
  };
  commitFirst().then(
    () => {
      try {
        dispatch(event);
      } catch (err) {
        console.error("[useMultiplayerGame] local REPLACE rejected by reducer", err);
        recordViolation(`local REPLACE failed: ${err instanceof Error ? err.message : String(err)}`);
        replacedForDraw.current = null;
        return;
      }
      publishEvent(db, roomId, event, otherPlayer(you))
        .then(() => (lastReplacer ? undefined : publishTurnStarted(db, roomId)))
        .catch((err: unknown) => {
          console.error("[useMultiplayerGame] failed to publish REPLACE", err);
        });
    },
    (err: unknown) => {
      console.error("[useMultiplayerGame] failed to commit replacement", err);
      replacedForDraw.current = null;
    },
  );
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
export function timeout(ctx: MultiplayerCtx): void {
  const { db, roomId, you, role, state, dispatch, recordViolation, refs } = ctx;
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
  try {
    dispatch(event);
  } catch (err) {
    console.error("[useMultiplayerGame] local TIMEOUT rejected by reducer", err);
    recordViolation(`local TIMEOUT failed: ${err instanceof Error ? err.message : String(err)}`);
    timedOutForDraw.current = null;
    return;
  }
  publishEvent(db, roomId, event, you)
    .then(() => publishTurnStarted(db, roomId))
    .catch((err: unknown) => {
      console.error("[useMultiplayerGame] failed to publish TIMEOUT", err);
    });
}

/**
 * Places my resolved pending card and tells the opponent (never throws).
 * `legalHands` is the root's render-time value (same snapshot as `ctx.state`).
 */
export function placePending(ctx: MultiplayerCtx, legalHands: number[], handIndex: number): void {
  const { db, roomId, you, role, state, dispatch, recordViolation, warnOnce, refs } = ctx;
  const { pendingPlacementSalts, ownSlotDraw, placedForDraw, timedOutOwnHiddenForDraw } = refs;
  const card = state.pendingCard;
  if (state.phase !== "placing" || state.turn !== you || !card) return;
  if (!legalHands.includes(handIndex)) return;
  if (placedForDraw.current === state.drawCount) return; // already in flight
  // Cross-guard against a narrow race with the intake queue's own-hidden-
  // timeout translation (handleOpponentTimeout in useOpponentEvents): if that
  // path already claimed this same draw, don't also dispatch a normal END_TURN
  // for it.
  if (timedOutOwnHiddenForDraw.current === state.drawCount) return;
  placedForDraw.current = state.drawCount;

  const faceDown = isFaceDownPlacement(state.hands[you][handIndex]);
  if (role === "dealer" && faceDown !== isFaceDownDraw(state.drawCount - 1, you)) {
    warnOnce(`own-facedown:${state.drawCount}`, `own placement faceDown=${faceDown} disagrees with draw-index rule (draw ${state.drawCount - 1})`);
  }
  const event: GameEvent = { type: "END_TURN", by: you, handIndex, faceDown };
  const placingDraw = state.drawCount - 1; // the draw this placed card came from
  const commitFirst = async () => {
    if (role !== "dealer" || !faceDown) return;
    const salt = generateSalt();
    const commitment = await commitPlacement(card, handIndex, salt);
    await publishReveal(db, roomId, { kind: "placementCommit", by: you, handIndex, commitment });
    pendingPlacementSalts.current.set(handIndex, salt);
    ownSlotDraw.current.set(handIndex, placingDraw);
  };
  commitFirst().then(
    () => {
      try {
        dispatch(event);
      } catch (err) {
        // A reducer throw here is a protocol-level failure, not a retryable one.
        console.error("[useMultiplayerGame] local END_TURN rejected by reducer", err);
        recordViolation(`local END_TURN failed: ${err instanceof Error ? err.message : String(err)}`);
        placedForDraw.current = null;
        return;
      }
      publishEvent(db, roomId, event, otherPlayer(you))
        .then(() => publishTurnStarted(db, roomId))
        .catch((err: unknown) => {
          console.error("[useMultiplayerGame] failed to publish END_TURN", err);
        });
    },
    (err: unknown) => {
      console.error("[useMultiplayerGame] failed to commit face-down placement", err);
      placedForDraw.current = null; // allow a retry
    },
  );
}
