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
  /**
   * True when an event was dispatched that THIS render's `state` does not
   * reflect yet (e.g. an earlier effect of the same commit dispatched). An
   * effect that decides from `state` must then skip: the dispatch always
   * re-renders, and the effect re-runs on the fresh state. Call it from
   * effects/handlers only, never during render.
   */
  hasPendingDispatch: () => boolean;
};

type Versioned = { game: GameState; version: number };
const versionedReducer = (s: Versioned, event: GameEvent): Versioned => ({
  game: gameReducer(s.game, event),
  version: s.version + 1,
});

/**
 * The shared heart of both game modes. `GameState` is derived; the log is the
 * source of truth. Solo dispatches straight here. The Phase 7 multiplayer hook
 * will dispatch here too — after a round-trip through Firebase — and fold the
 * opponent's events exactly the same way.
 */
export function useGameEngine(init: InitOptions): GameEngine {
  const [{ game: state, version }, raw] = useReducer(versionedReducer, init, (i) => ({
    game: createInitialState(i),
    version: 0,
  }));
  const log = useRef<GameEvent[]>([]);
  // Dispatches issued; the reducer's `version` counts dispatches applied.
  const issued = useRef(0);

  const dispatch = useCallback((event: GameEvent) => {
    issued.current += 1;
    log.current.push(event);
    playEventSfx(event);
    raw(event);
  }, []);

  const getEvents = useCallback(() => log.current as readonly GameEvent[], []);
  const hasPendingDispatch = () => issued.current !== version;

  return { state, dispatch, getEvents, hasPendingDispatch };
}
