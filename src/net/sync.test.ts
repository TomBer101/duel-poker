import { afterEach, describe, expect, test, vi } from "vitest";
import { waitForConnection } from "./sync";

/** A fake `subscribeToConnection`: exposes the callback and counts unsubscribes. */
function fakeSubscribe() {
  const fake = {
    emit: (() => {}) as (connected: boolean) => void,
    unsubscribes: 0,
    subscribe: (cb: (connected: boolean) => void) => {
      fake.emit = cb;
      return () => {
        fake.unsubscribes++;
      };
    },
  };
  return fake;
}

describe("waitForConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves true once connected arrives, and unsubscribes", async () => {
    vi.useFakeTimers();
    const fake = fakeSubscribe();
    const result = waitForConnection(fake.subscribe, 5000);
    fake.emit(false);
    fake.emit(true);
    await expect(result).resolves.toBe(true);
    expect(fake.unsubscribes).toBe(1);
  });

  test("resolves true when connected is reported synchronously on subscribe", async () => {
    const unsubscribe = vi.fn();
    const result = waitForConnection((cb) => {
      cb(true);
      return unsubscribe;
    }, 5000);
    await expect(result).resolves.toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("resolves false after the timeout, and unsubscribes", async () => {
    vi.useFakeTimers();
    const fake = fakeSubscribe();
    const result = waitForConnection(fake.subscribe, 5000);
    fake.emit(false);
    vi.advanceTimersByTime(5000);
    await expect(result).resolves.toBe(false);
    expect(fake.unsubscribes).toBe(1);
  });
});
