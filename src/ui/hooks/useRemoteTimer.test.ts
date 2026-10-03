import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { useRemoteTimer } from "./useRemoteTimer";

// Captures the subscriber so each test delivers turn timestamps LATER, like
// Firebase does (a synchronous mock hid the stale-timestamp bugs).
let deliver: (at: number) => void = () => {};
let subscribeCount = 0;
vi.mock("../../net/roomState", () => ({
  subscribeToTurnStarted: (_db: unknown, _roomId: string, cb: (at: number) => void) => {
    subscribeCount++;
    deliver = cb;
    return () => {};
  },
}));

const D = 10_000;
const DB = {} as never;
type Props = { active: boolean; turnKey: string };

function setup(onExpire: () => void, initial: Props = { active: true, turnKey: "placing:p1" }) {
  return renderHook(
    ({ active, turnKey }: Props) => useRemoteTimer(DB, "room", active, D, onExpire, turnKey),
    { initialProps: initial },
  );
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("useRemoteTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeCount = 0;
  });
  afterEach(() => vi.useRealTimers());

  test("D: first activation (nothing stale) accepts the first timestamp and fires once", () => {
    const onExpire = vi.fn();
    setup(onExpire);
    advance(D * 2);
    expect(onExpire).not.toHaveBeenCalled(); // no timestamp yet
    act(() => deliver(Date.now() - D + 500));
    advance(1_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    advance(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test("E: countdown shows remaining time, not the full duration, once a timestamp arrives", () => {
    const { result } = setup(vi.fn());
    expect(result.current).toBe(10);
    act(() => deliver(Date.now() - 4_000));
    advance(200);
    expect(result.current).toBeLessThanOrEqual(6);
    expect(result.current).toBeGreaterThan(0);
  });

  test("B: one always-active instance fires on turn 1 and again on turn 2", () => {
    const onExpire = vi.fn();
    const { rerender } = setup(onExpire);
    act(() => deliver(Date.now()));
    advance(D + 500);
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender({ active: true, turnKey: "placing:p2" });
    act(() => deliver(Date.now()));
    advance(D + 500);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  test("C: the old timestamp expiring in the gap after a turn change does not fire", () => {
    const onExpire = vi.fn();
    const { rerender } = setup(onExpire);
    const t1 = Date.now();
    act(() => deliver(t1));
    advance(D / 2);
    rerender({ active: true, turnKey: "placing:p2" });
    advance(D * 2); // well past t1 + D, new timestamp still not delivered
    expect(onExpire).not.toHaveBeenCalled();
    act(() => deliver(t1)); // a re-delivery of the old value is ignored
    advance(1_000);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => deliver(Date.now()));
    advance(D + 500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test("A: re-activation does not fire on the previous turn's stale timestamp", () => {
    const onExpire = vi.fn();
    const { rerender } = setup(onExpire);
    const t1 = Date.now();
    act(() => deliver(t1));
    advance(D / 2);
    rerender({ active: false, turnKey: "placing:p1" });
    advance(D); // t1 is now long expired
    rerender({ active: true, turnKey: "placing:p2" });
    expect(subscribeCount).toBe(2); // re-subscribed
    act(() => deliver(t1)); // Firebase re-delivers the current (old) value on subscribe
    advance(1_000);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => deliver(Date.now())); // the new turn's value
    advance(D + 500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test("returns durationMs while inactive", () => {
    const { result } = setup(vi.fn(), { active: false, turnKey: "x" });
    expect(result.current).toBe(10);
  });
});
