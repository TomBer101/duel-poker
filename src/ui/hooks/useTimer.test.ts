import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimer } from "./useTimer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTimer", () => {
  it("holds at the full duration while inactive", () => {
    const { result } = renderHook(() => useTimer(false, 5000, vi.fn()));
    expect(result.current).toBe(5);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(5);
  });

  it("counts down once active, and restarts fresh each time it turns active", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useTimer(active, 5000, vi.fn()),
      { initialProps: { active: true } },
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(3);

    rerender({ active: false });
    expect(result.current).toBe(5);

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(4); // fresh countdown, not resuming at 3
  });

  it("calls onExpire exactly once when it reaches 0", () => {
    const onExpire = vi.fn();
    renderHook(() => useTimer(true, 1000, onExpire));
    act(() => vi.advanceTimersByTime(1000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(onExpire).toHaveBeenCalledTimes(1); // the interval was cleared
  });

  it("always calls the latest onExpire, not a stale closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onExpire }) => useTimer(true, 1000, onExpire),
      { initialProps: { onExpire: first } },
    );
    rerender({ onExpire: second });
    act(() => vi.advanceTimersByTime(1000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
