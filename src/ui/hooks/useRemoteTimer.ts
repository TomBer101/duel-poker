import { useEffect, useRef, useState } from "react";
import type { Database } from "../../net/firebase";
import { subscribeToTurnStarted } from "../../net/roomState";

const TICK_MS = 200;

/**
 * Like {@link ./useTimer.ts}'s local countdown, but anchored to the room's
 * server-timestamped `turnStartedAt` instead of the moment this hook
 * mounted — so a page refresh mid-turn resumes the same countdown instead
 * of granting a fresh `durationMs`, and both clients agree on the deadline
 * even though their local clocks may differ slightly.
 *
 * The hook tracks one turn at a time, identified by `turnKey`. When `turnKey`
 * changes (or `active` flips) the current timestamp is remembered as `stale`,
 * `startedAt` and the fired latch are cleared, and any delivered value equal
 * to `stale` is ignored: the new turn's timestamp may arrive later than the
 * local turn change, and Firebase re-delivers the current (old) value on
 * every re-subscribe. `onExpire` therefore fires at most once per turn.
 * It is read through a ref (same reasoning as `useTimer`).
 */
export function useRemoteTimer(
  db: Database,
  roomId: string,
  active: boolean,
  durationMs: number,
  onExpire: () => void,
  turnKey: string,
): number {
  const [msLeft, setMsLeft] = useState(durationMs);
  const startedAt = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  const firedRef = useRef(false);
  const stale = useRef<number | null>(null);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  // Declared before the subscription effect so a reset always runs first
  // within a commit.
  // Only a real change counts: a StrictMode re-run has identical props and
  // must not discard a value the subscription already delivered.
  // Accepted narrow case: if a turn is skipped before its value arrives, that
  // late value can be taken as the next turn's start.
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${active}|${turnKey}`;
    if (prev.current === sig) return;
    prev.current = sig;
    stale.current = startedAt.current ?? stale.current;
    startedAt.current = null;
    firedRef.current = false;
  }, [turnKey, active]);

  useEffect(() => {
    if (!active) return;
    return subscribeToTurnStarted(db, roomId, (at) => {
      if (at === stale.current) return;
      startedAt.current = at;
    });
  }, [db, roomId, active]);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (startedAt.current === null) {
        setMsLeft(durationMs);
        return;
      }
      const left = Math.max(0, durationMs - (Date.now() - startedAt.current));
      setMsLeft(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };
    const intervalId = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(intervalId);
  }, [active, durationMs, turnKey]);

  return Math.ceil((active ? msLeft : durationMs) / 1000);
}
