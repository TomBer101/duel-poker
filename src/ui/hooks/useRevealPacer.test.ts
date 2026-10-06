import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../engine/reducer";
import type { GameState } from "../../engine/types";
import { useRevealPacer } from "./useRevealPacer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const revealing: GameState = {
  ...createInitialState({ mode: "multiplayer" }),
  phase: "reveal",
  result: { matchups: [], wins: { p1: 0, p2: 0 }, winner: "draw" },
};

describe("useRevealPacer", () => {
  it.each([
    [true, 1],
    [false, 0],
  ])("enabled=%s dispatches %i ADVANCE_REVEAL after one step", (enabled, calls) => {
    const dispatch = vi.fn();
    renderHook(() => useRevealPacer(revealing, dispatch, 100, enabled));
    vi.advanceTimersByTime(100);
    expect(dispatch).toHaveBeenCalledTimes(calls);
  });
});
