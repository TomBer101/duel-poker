import { useEffect, useRef, useState } from "react";
import type { Database } from "../../../net/firebase";
import { otherPlayer } from "../../../engine/deck";
import type { GameState, PlayerId } from "../../../engine/types";
import { incrementScore, subscribeToScore } from "../../../net/roomState";

export type SessionScore = { you: number; opponent: number };

const MAX_SCORE_ATTEMPTS = 3;
const SCORE_RETRY_DELAY_MS = 500;

/**
 * Session score for a room (undefined in solo, i.e. no roomId). Only the
 * WINNER's client writes, and only its own seat, once per mounted game (the
 * body is remounted per gameNumber, so the ref resets for free); losses and
 * draws write nothing. A rules denial means this game is already counted (the
 * once-per-game rule, e.g. after a refresh on the result screen): logged, not
 * retried. Any other failure is retried up to MAX_SCORE_ATTEMPTS in total.
 * Never unhandled.
 */
export function useSessionScore(
  db: Database,
  roomId: string | undefined,
  you: PlayerId,
  gameNumber: number,
  state: GameState,
): SessionScore | undefined {
  const [score, setScore] = useState<Record<PlayerId, number>>({ p1: 0, p2: 0 });
  const scored = useRef(false);

  useEffect(() => {
    if (!roomId) return;
    return subscribeToScore(db, roomId, setScore);
  }, [db, roomId]);

  const winner = state.phase === "result" ? state.result?.winner : undefined;
  useEffect(() => {
    if (!roomId || winner !== you || scored.current) return;
    scored.current = true; // in flight or done: the retries below own it from here
    let attempts = 0;
    const attempt = (): void => {
      attempts += 1;
      incrementScore(db, roomId, you, gameNumber).catch((err: unknown) => {
        const denied = /permission.denied/i.test(err instanceof Error ? err.message : String(err));
        if (denied || attempts >= MAX_SCORE_ATTEMPTS) {
          console.error(`[useSessionScore] score increment ${denied ? "denied (already counted?)" : "failed"}`, err);
          return;
        }
        console.warn(`[useSessionScore] score increment failed (attempt ${attempts}), retrying`, err);
        setTimeout(attempt, SCORE_RETRY_DELAY_MS);
      });
    };
    attempt();
  }, [db, roomId, winner, you, gameNumber]);

  return roomId ? { you: score[you], opponent: score[otherPlayer(you)] } : undefined;
}
