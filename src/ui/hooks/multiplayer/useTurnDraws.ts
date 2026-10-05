import { useEffect } from "react";
import { DECK_SIZE } from "../../../engine/constants";
import { resolvedDraw } from "../../../crypto/protocolController";
import { DEAL_SLOTS, isFaceDownDraw, replaceDrawIndex } from "../../../crypto/drawSchedule";
import type { MultiplayerCtx } from "./context";

/** Resolves each per-turn draw (placing or replace) into a DRAW / REPLACE_DRAW. */
export function useTurnDraws(ctx: MultiplayerCtx): void {
  const { you, role, state, dispatch, hasPendingDispatch, protocol, dealerState } = ctx;

  // Resolve this turn's draw into a DRAW / REPLACE_DRAW as soon as its reveals
  // verify. Both clients do this independently, exactly like DEAL. Skipped
  // while an earlier effect of this commit dispatched (e.g. the intake applied
  // a TIMEOUT that already consumed this draw): `state` is stale until the
  // re-render, which re-runs this.
  useEffect(() => {
    if (!role || hasPendingDispatch()) return;
    if (state.phase !== "placing" && state.phase !== "replace") return;
    if (state.pendingCard !== null) return;
    const drawIndex = state.drawCount;
    if (drawIndex < DEAL_SLOTS.length || drawIndex >= DECK_SIZE) return;
    let card = resolvedDraw(protocol.current, drawIndex);
    const ownSecretDraw =
      state.phase === "placing" ? isFaceDownDraw(drawIndex, you) : drawIndex === replaceDrawIndex(you);
    if (!card && role === "dealer" && ownSecretDraw) {
      // My own face-down turn / replace draw: no card reveal is ever published
      // for it, so read the card from my own deck once the position is known.
      const position = protocol.current.positions[drawIndex];
      if (position !== undefined && dealerState.current) card = dealerState.current.deck[position];
    }
    if (!card) return;
    dispatch(
      state.phase === "placing"
        ? { type: "DRAW", by: state.turn, card }
        : { type: "REPLACE_DRAW", by: state.turn, card },
    );
  });
}
