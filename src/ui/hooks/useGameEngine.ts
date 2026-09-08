import { useCallback, useReducer, useRef } from "react";
import { createInitialState, gameReducer, type InitOptions } from "../../engine/reducer";
import type { GameEvent, GameState } from "../../engine/types";
import { playEventSfx } from "../sound/gameSounds";

export type GameEngine = {
  state: GameState;
  /**
   * Apply an event: append it to the log, play its sound, fold it into `state`.
   * Stable identity for the life of the hook — safe to list in effect deps.
   */
  dispatch: (event: GameEvent) => void;
  /**
   * Snapshot of the append-only event log — the real source of truth. Replaying
   * it through `gameReducer` from the initial state reproduces `state` exactly.
   * A function (not a value) so it never reads a ref during render.
   */
  getEvents: () => readonly GameEvent[];
};

/**
 * The shared heart of both game modes. `GameState` is derived; the log is the
 * source of truth. Solo dispatches straight here. The Phase 7 multiplayer hook
 * will dispatch here too — after a round-trip through Firebase — and fold the
 * opponent's events exactly the same way.
 */
export function useGameEngine(init: InitOptions): GameEngine {
  const [state, raw] = useReducer(gameReducer, init, createInitialState);
  const log = useRef<GameEvent[]>([]);

  const dispatch = useCallback((event: GameEvent) => {
    log.current.push(event);
    playEventSfx(event);
    raw(event);
  }, []);

  const getEvents = useCallback(() => log.current as readonly GameEvent[], []);

  return { state, dispatch, getEvents };
}
