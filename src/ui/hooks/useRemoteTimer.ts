import { useEffect, useRef, useState } from "react";
import type { Database } from "firebase/database";
import { subscribeToTurnStarted } from "../../net/roomState";

const TICK_MS = 200;

/**
 * Like {@link ./useTimer.ts}'s local countdown, but anchored to the room's
 * server-timestamped `turnStartedAt` instead of the moment this hook
 * mounted — so a page refresh mid-turn resumes the same countdown instead
 * of granting a fresh `durationMs`, and both clients agree on the deadline
 * even though their local clocks may differ slightly.
 *
 * `onExpire` is read through a ref (same reasoning as `useTimer`) and fires
 * at most once per `active` mount, guarded by `firedRef` — the subscription
 * can keep delivering the same (or a stale) `turnStartedAt` after expiry.
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
  useEffect(() => {
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
