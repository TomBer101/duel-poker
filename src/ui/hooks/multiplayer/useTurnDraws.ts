import { useEffect } from "react";
import { DECK_SIZE } from "../../../engine/constants";
import { resolvedDraw } from "../../../crypto/protocolController";
import { DEAL_SLOTS, isFaceDownDraw, replaceDrawIndex } from "../../../crypto/drawSchedule";
import type { Card } from "../../../engine/types";
import type { MultiplayerCtx } from "./context";

/**
 * Resolves each per-turn draw (placing or replace) into a DRAW / REPLACE_DRAW
 * once its reveals verify. The opponent's draw is applied automatically (both
 * clients derive the same log); MY draw waits for the player to click the pile
 * (`canDraw` / `draw`). Nothing is published for a draw, so waiting is free:
 * the turn timer runs from the turn's start either way.
 */
export function useTurnDraws(ctx: MultiplayerCtx): { canDraw: boolean; draw: () => void } {
  const { you, state } = ctx;

  useEffect(() => {
    if (state.turn !== you) drawNext(ctx);
  });

  return { canDraw: state.turn === you && nextDrawCard(ctx) !== null, draw: () => void drawNext(ctx) };
}

/** The card of this turn's not-yet-drawn draw, once its reveals verify; else null. */
function nextDrawCard(ctx: MultiplayerCtx): Card | null {
  const { you, role, state, protocol, dealerState } = ctx;
  if (!role) return null;
  if (state.phase !== "placing" && state.phase !== "replace") return null;
  if (state.pendingCard !== null) return null;
  const drawIndex = state.drawCount;
  if (drawIndex < DEAL_SLOTS.length || drawIndex >= DECK_SIZE) return null;
  let card = resolvedDraw(protocol.current, drawIndex);
  const ownSecretDraw =
    state.phase === "placing" ? isFaceDownDraw(drawIndex, you) : drawIndex === replaceDrawIndex(you);
  if (!card && role === "dealer" && ownSecretDraw) {
    // My own face-down turn / replace draw: no card reveal is ever published
    // for it, so read the card from my own deck once the position is known.
    const position = protocol.current.positions[drawIndex];
    if (position !== undefined && dealerState.current) card = dealerState.current.deck[position];
  }
  return card ?? null;
}

/**
 * Dispatches this turn's DRAW / REPLACE_DRAW if its card is known; returns
 * whether it did. Also used by the intake when replaying my own logged move
 * (catch-up): the move proves I drew, and no click will ever come for it.
 * Skipped while an earlier effect of this commit dispatched (e.g. the intake
 * applied a TIMEOUT that already consumed this draw): `state` is stale until
 * the re-render, which re-runs this.
 */
export function drawNext(ctx: MultiplayerCtx): boolean {
  const { state, dispatch, hasPendingDispatch } = ctx;
  if (hasPendingDispatch()) return false;
  const card = nextDrawCard(ctx);
  if (!card) return false;
  dispatch(
    state.phase === "placing"
      ? { type: "DRAW", by: state.turn, card }
      : { type: "REPLACE_DRAW", by: state.turn, card },
  );
  return true;
}
