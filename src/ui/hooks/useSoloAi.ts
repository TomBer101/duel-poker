import type { RefObject } from "react";
import { useEffect } from "react";
import { createAiOpponent } from "../../ai";
import { isFaceDownPlacement } from "../../engine/placement";
import type { Card, GameEvent, GameState, PlayerId } from "../../engine/types";

/** Beats (ms) that make the AI feel like it is thinking, not snapping. */
const AI_DRAW_DELAY = 650;
const AI_PLACE_DELAY = 750;

export type SoloAiOptions = {
  state: GameState;
  /** Seat the AI holds. */
  ai: PlayerId;
  /** The client-side deck; `state.drawCount` is the cursor into it. */
  deck: RefObject<Card[]>;
  dispatch: (event: GameEvent) => void;
};

/**
 * Watches for the AI's turn and plays it out against the Phase 3 opponent.
 *
 * Two effects — draw, then place — each keyed on *committed* state, so a step
 * never reads a reducer update React has not applied yet. Nothing else moves
 * during the AI's turn, so each effect can trust the `state` it closed over.
 */
export function useSoloAi({ state, ai, deck, dispatch }: SoloAiOptions): void {
  const active =
    state.turn === ai &&
    (state.phase === "placing" || state.phase === "replace");

  // 1. AI's turn, nothing drawn yet -> draw after a beat.
  useEffect(() => {
    if (!active || state.pendingCard) return;
    const type = state.phase === "placing" ? "DRAW" : "REPLACE_DRAW";
    const id = setTimeout(() => {
      dispatch({ type, by: ai, card: deck.current[state.drawCount] });
    }, AI_DRAW_DELAY);
    return () => clearTimeout(id);
  }, [active, state.phase, state.pendingCard, state.drawCount, ai, deck, dispatch]);

  // 2. AI's turn, card in hand -> place / replace after a beat.
  useEffect(() => {
    if (!active || !state.pendingCard) return;
    const card = state.pendingCard;
    const opponent = createAiOpponent(ai);
    const id = setTimeout(() => {
      if (state.phase === "placing") {
        const handIndex = opponent.chooseHandIndex(state, card);
        dispatch({
          type: "END_TURN",
          by: ai,
          handIndex,
          faceDown: isFaceDownPlacement(state.hands[ai][handIndex]),
        });
      } else {
        const { handIndex } = opponent.chooseReplacement(state, card);
        dispatch({ type: "REPLACE", by: ai, handIndex });
      }
    }, AI_PLACE_DELAY);
    return () => clearTimeout(id);
  }, [active, state, ai, dispatch]);
}
