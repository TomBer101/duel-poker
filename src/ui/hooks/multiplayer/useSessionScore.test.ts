import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Database } from "firebase/database";
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

beforeEach(() => vi.mocked(incrementScore).mockClear());

describe("useSessionScore", () => {
  test("the winner's client increments once with its own seat and the gameNumber", () => {
    const { rerender } = renderHook(({ s }) => useSessionScore(db, "R", "p2", 3, s), {
      initialProps: { s: placing },
    });
    expect(incrementScore).not.toHaveBeenCalled();
    rerender({ s: resultState("p2") });
    rerender({ s: resultState("p2") });
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

  test("a rejected increment is swallowed", async () => {
    vi.mocked(incrementScore).mockRejectedValueOnce(new Error("permission_denied"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useSessionScore(db, "R", "p1", 1, resultState("p1")));
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});
