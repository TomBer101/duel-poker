import { useEffect, useRef, useState } from "react";
import type { Database } from "firebase/database";
import { otherPlayer } from "../../../engine/deck";
import type { GameState, PlayerId } from "../../../engine/types";
import { incrementScore, subscribeToScore } from "../../../net/roomState";

export type SessionScore = { you: number; opponent: number };

/**
 * Session score for a room (undefined in solo, i.e. no roomId). Only the
 * WINNER's client writes, and only its own seat, once per mounted game (the
 * body is remounted per gameNumber, so the ref resets for free); losses and
 * draws write nothing. A rejected write (e.g. the once-per-game rule) is
 * logged, never unhandled.
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
    scored.current = true;
    incrementScore(db, roomId, you, gameNumber).catch((err: unknown) => {
      console.error("[useSessionScore] score increment failed", err);
    });
  }, [db, roomId, winner, you, gameNumber]);

  return roomId ? { you: score[you], opponent: score[otherPlayer(you)] } : undefined;
}
