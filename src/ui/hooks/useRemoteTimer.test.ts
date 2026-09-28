import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { useRemoteTimer } from "./useRemoteTimer";

vi.mock("../../net/roomState", () => ({
  subscribeToTurnStarted: (
    _db: unknown,
    _roomId: string,
    callback: (at: number) => void,
  ) => {
    callback(Date.now() - 5_000); // turn started 5s ago
    return () => {};
  },
}));

describe("useRemoteTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("counts down from the remaining time, not the full duration", () => {
    const { result } = renderHook(() =>
      useRemoteTimer({} as never, "room", true, 60_000, () => {}),
    );
    expect(result.current).toBeLessThanOrEqual(55);
    expect(result.current).toBeGreaterThan(0);
  });

  test("calls onExpire once when the remaining time reaches 0", () => {
    const onExpire = vi.fn();
    renderHook(() => useRemoteTimer({} as never, "room", true, 1_000, onExpire));
    act(() => vi.advanceTimersByTime(1_500));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test("returns durationMs while inactive and never subscribes", () => {
    const { result } = renderHook(() =>
      useRemoteTimer({} as never, "room", false, 30_000, () => {}),
    );
    expect(result.current).toBe(30);
  });
});
