import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PlayerId } from "../../../engine/types";
import type { MultiplayerCtx } from "./context";
import { playAgain } from "./myMoves";
import { useRematch } from "./useRematch";

type Votes = Partial<Record<PlayerId, boolean>>;

const h = vi.hoisted(() => ({
  deliver: null as null | ((v: Votes) => void),
  publishRematchVote: vi.fn(() => Promise.resolve()),
  resetForRematch: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../net/roomState", () => ({
  subscribeToRematch: (_db: unknown, _room: string, cb: (v: Votes) => void) => {
    h.deliver = cb;
    return () => {};
  },
  publishRematchVote: h.publishRematchVote,
  resetForRematch: h.resetForRematch,
  publishTurnStarted: vi.fn(),
}));

function makeCtx(over: Partial<MultiplayerCtx> = {}): MultiplayerCtx {
  return {
    db: {} as MultiplayerCtx["db"],
    roomId: "R",
    you: "p1",
    gameNumber: 1,
    dealer: "p1",
    state: { phase: "result" } as MultiplayerCtx["state"],
    refs: { rematchVoted: { current: false } } as unknown as MultiplayerCtx["refs"],
    ...over,
  } as MultiplayerCtx;
}

beforeEach(() => {
  h.publishRematchVote.mockClear();
  h.resetForRematch.mockClear();
  h.resetForRematch.mockImplementation(() => Promise.resolve());
});

describe("useRematch", () => {
  test("one vote alone does nothing; both votes -> p1 resets once with the flipped dealer", () => {
    const { result, rerender } = renderHook(() => useRematch(makeCtx()));
    act(() => h.deliver!({ p1: true }));
    expect(h.resetForRematch).not.toHaveBeenCalled();
    expect(result.current.rematchRequested).toBe(true);
    act(() => h.deliver!({ p1: true, p2: true }));
    expect(h.resetForRematch).toHaveBeenCalledTimes(1);
    expect(h.resetForRematch).toHaveBeenCalledWith({}, "R", "p2", 2);
    act(() => h.deliver!({ p1: true, p2: true }));
    rerender();
    expect(h.resetForRematch).toHaveBeenCalledTimes(1);
  });

  test("dealer unknown: no reset until it arrives, then exactly one", () => {
    let dealer: PlayerId | null = null;
    const { rerender } = renderHook(() => useRematch(makeCtx({ dealer })));
    act(() => h.deliver!({ p1: true, p2: true }));
    expect(h.resetForRematch).not.toHaveBeenCalled();
    dealer = "p2";
    rerender();
    expect(h.resetForRematch).toHaveBeenCalledTimes(1);
    expect(h.resetForRematch).toHaveBeenCalledWith({}, "R", "p1", 2);
  });

  test("p2 never resets, and its own vote is rematchRequested", () => {
    const { result } = renderHook(() => useRematch(makeCtx({ you: "p2", dealer: "p1" })));
    act(() => h.deliver!({ p2: true }));
    expect(result.current.rematchRequested).toBe(true);
    act(() => h.deliver!({ p1: true, p2: true }));
    expect(h.resetForRematch).not.toHaveBeenCalled();
  });

  test("the opponent's vote alone is not my rematchRequested", () => {
    const { result } = renderHook(() => useRematch(makeCtx()));
    act(() => h.deliver!({ p2: true }));
    expect(result.current.rematchRequested).toBe(false);
  });

  test("a rejected reset is caught and logged (no unhandled rejection) and not retried", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.resetForRematch.mockImplementation(() => Promise.reject(new Error("permission_denied")));
    renderHook(() => useRematch(makeCtx()));
    await act(async () => h.deliver!({ p1: true, p2: true }));
    await act(async () => h.deliver!({ p1: true, p2: true }));
    expect(h.resetForRematch).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("playAgain", () => {
  test("a previous mount's stale handle cannot vote again after the reset", () => {
    const ctx = makeCtx();
    playAgain(ctx); // game 1 vote
    h.publishRematchVote.mockClear();
    playAgain(ctx); // stale click on the old handle after the room moved on
    expect(h.publishRematchVote).not.toHaveBeenCalled();
  });

  test("is a no-op before the result phase", () => {
    const ctx = makeCtx({ state: { phase: "placing" } as MultiplayerCtx["state"] });
    playAgain(ctx);
    expect(h.publishRematchVote).not.toHaveBeenCalled();
  });

  test("publishes once however often it is called", () => {
    const ctx = makeCtx();
    playAgain(ctx);
    playAgain(ctx);
    expect(h.publishRematchVote).toHaveBeenCalledTimes(1);
    expect(h.publishRematchVote).toHaveBeenCalledWith({}, "R", "p1");
  });
});
