import { useEffect } from "react";
import { HANDS_PER_PLAYER } from "../../engine/constants";
import type { GameEvent, GameState } from "../../engine/types";

/** Pause between each hand during the auto-advancing reveal. */
export const REVEAL_STEP_MS = 3000;

/**
 * While the game is in the reveal phase, dispatch one `ADVANCE_REVEAL` every
 * `stepMs` until all hands are shown. Mode-agnostic: the reveal is a scripted
 * sequence, not an interaction. `enabled` false holds the pacer (multiplayer:
 * a protocol violation must never let the game reach its result).
 */
export function useRevealPacer(
  state: GameState,
  dispatch: (event: GameEvent) => void,
  stepMs: number = REVEAL_STEP_MS,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || state.phase !== "reveal" || state.result === null || state.revealIndex >= HANDS_PER_PLAYER) return;
    const id = setTimeout(() => dispatch({ type: "ADVANCE_REVEAL" }), stepMs);
    return () => clearTimeout(id);
  }, [enabled, state.phase, state.result, state.revealIndex, stepMs, dispatch]);
}
