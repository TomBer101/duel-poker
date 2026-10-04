import { useEffect, useRef, useState } from "react";
import { otherPlayer } from "../../../engine/deck";
import type { PlayerId } from "../../../engine/types";
import { resetForRematch, subscribeToRematch } from "../../../net/roomState";
import type { MultiplayerCtx } from "./context";

/**
 * Rematch votes. A rematch is a REMOUNT (GameScreen keys the body by the
 * room's gameNumber), so this hook only observes the votes and, on p1's
 * client alone, runs the atomic room reset once both are in. It never resets
 * local state itself. A reset that loses a race or is denied is logged and
 * not retried for this gameNumber (the room is then already on the next game,
 * or the rules said no).
 */
export function useRematch(ctx: MultiplayerCtx): { rematchRequested: boolean } {
  const { db, roomId, you, gameNumber, dealer } = ctx;
  const [votes, setVotes] = useState<Partial<Record<PlayerId, boolean>>>({});
  const resetFor = useRef<number | null>(null);

  useEffect(() => subscribeToRematch(db, roomId, setVotes), [db, roomId]);

  const both = votes.p1 === true && votes.p2 === true;
  useEffect(() => {
    if (!both || you !== "p1" || !dealer || resetFor.current === gameNumber) return;
    resetFor.current = gameNumber;
    resetForRematch(db, roomId, otherPlayer(dealer), gameNumber + 1).catch((err: unknown) => {
      console.error("[useMultiplayerGame] rematch reset failed", err);
    });
  }, [both, you, dealer, db, roomId, gameNumber]);

  return { rematchRequested: votes[you] === true };
}
