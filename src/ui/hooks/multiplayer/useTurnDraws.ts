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
  const { you, role, state, dispatch, hasPendingDispatch, protocol, dealerState } = ctx;

  const nextDrawCard = (): Card | null => {
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
  };

  // Skipped while an earlier effect of this commit dispatched (e.g. the intake
  // applied a TIMEOUT that already consumed this draw): `state` is stale until
  // the re-render, which re-runs this.
  const draw = () => {
    if (hasPendingDispatch()) return;
    const card = nextDrawCard();
    if (!card) return;
    dispatch(
      state.phase === "placing"
        ? { type: "DRAW", by: state.turn, card }
        : { type: "REPLACE_DRAW", by: state.turn, card },
    );
  };

  useEffect(() => {
    if (state.turn !== you) draw();
  });

  return { canDraw: state.turn === you && nextDrawCard() !== null, draw };
}
