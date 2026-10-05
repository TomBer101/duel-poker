import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Database } from "../../../net/firebase";
import type { GameState, PlayerId } from "../../../engine/types";
import { incrementScore } from "../../../net/roomState";
import { useSessionScore } from "./useSessionScore";

vi.mock("../../../net/roomState", () => ({
  subscribeToScore: vi.fn(() => () => {}),
  incrementScore: vi.fn(() => Promise.resolve()),
}));

const db = {} as Database;
const resultState = (winner: PlayerId | "tie" | "draw") =>
  ({ phase: "result", result: { winner } }) as unknown as GameState;
const placing = { phase: "placing", result: null } as unknown as GameState;

beforeEach(() => vi.mocked(incrementScore).mockReset().mockResolvedValue());
afterEach(() => vi.useRealTimers());

describe("useSessionScore", () => {
  test("the winner's client increments once with its own seat and the gameNumber, even when the effect re-runs", () => {
    const { rerender } = renderHook(({ s, d }) => useSessionScore(d, "R", "p2", 3, s), {
      initialProps: { s: placing, d: db },
    });
    expect(incrementScore).not.toHaveBeenCalled();
    rerender({ s: resultState("p2"), d: db });
    // A new db identity is a changed dep: the effect really re-runs, so only
    // the ref guard keeps this to one write.
    rerender({ s: resultState("p2"), d: {} as Database });
    expect(incrementScore).toHaveBeenCalledTimes(1);
    expect(incrementScore).toHaveBeenCalledWith(db, "R", "p2", 3);
  });

  test.each(["p1", "tie", "draw"] as const)("never increments when the result is %s", (w) => {
    renderHook(() => useSessionScore(db, "R", "p2", 1, resultState(w)));
    expect(incrementScore).not.toHaveBeenCalled();
  });

  test("solo (no room) neither writes nor reports a session score", () => {
    const { result } = renderHook(() => useSessionScore(db, undefined, "p1", 1, resultState("p1")));
    expect(incrementScore).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  test("a rules denial (already counted) is logged and not retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.mocked(incrementScore).mockRejectedValueOnce(new Error("PERMISSION_DENIED: Permission denied"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useSessionScore(db, "R", "p1", 1, resultState("p1")));
    await vi.advanceTimersByTimeAsync(5000);
    expect(incrementScore).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  test("a transient failure is retried until it lands", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.mocked(incrementScore).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useSessionScore(db, "R", "p1", 1, resultState("p1")));
    await vi.advanceTimersByTimeAsync(5000);
    expect(incrementScore).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("retries are bounded: three failed attempts, then one logged error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    for (let i = 0; i < 3; i++) vi.mocked(incrementScore).mockRejectedValueOnce(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useSessionScore(db, "R", "p1", 1, resultState("p1")));
    await vi.advanceTimersByTimeAsync(10000);
    expect(incrementScore).toHaveBeenCalledTimes(3);
    expect(err).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    err.mockRestore();
  });
});
