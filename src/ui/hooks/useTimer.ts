import { useEffect, useRef, useState } from "react";

/** How often the countdown re-renders. Coarser than 1s so the last second
 *  still lands close to exactly 0, finer than 1s so it doesn't look choppy. */
const TICK_MS = 200;

/**
 * A countdown from `durationMs`, running only while `active` is true and
 * restarting fresh every time `active` flips false -> true. Calls `onExpire`
 * once when it reaches 0.
 *
 * `onExpire` is read through a ref, not a dependency — the caller (a plain
 * function like `useSoloGame`'s `timeout()`) doesn't need to be wrapped in
 * `useCallback` just to satisfy this hook.
 *
 * `msLeft` is only ever written from a timer callback, never synchronously in
 * the effect body (React's `set-state-in-effect` rule) — while inactive, the
 * return value is just `durationMs` directly rather than a stored, possibly
 * stale, reset value.
 */
export function useTimer(
  active: boolean,
  durationMs: number,
  onExpire: () => void,
): number {
  const [msLeft, setMsLeft] = useState(durationMs);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const tick = () => {
      const left = Math.max(0, durationMs - (Date.now() - startedAt));
      setMsLeft(left);
      if (left <= 0) {
        clearInterval(intervalId);
        onExpireRef.current();
      }
    };
    const intervalId = setInterval(tick, TICK_MS);
    // Run once almost immediately (async, so it's a timer callback rather
    // than a synchronous effect-body call) so the display doesn't sit on a
    // stale value from a previous countdown for a whole TICK_MS.
    const primeId = setTimeout(tick, 0);
    return () => {
      clearInterval(intervalId);
      clearTimeout(primeId);
    };
  }, [active, durationMs]);

  return Math.ceil((active ? msLeft : durationMs) / 1000);
}
