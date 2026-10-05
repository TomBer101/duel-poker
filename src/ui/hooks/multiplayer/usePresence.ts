import { useEffect } from "react";
import type { Database } from "firebase/database";
import type { PlayerId } from "../../../engine/types";
import { setupPresence, subscribeToConnection } from "../../../net/sync";

/**
 * Marks my seat present while the game page is mounted, and again after every
 * reconnect: the server already ran my onDisconnect (presence false) on the
 * drop, so each `connected === true` re-arms it and writes true. This keeps a
 * live, reconnected player from being forfeited (the FORFEIT rule requires
 * the forfeiting seat's presence to be false). No-op without a room (solo).
 */
export function usePresence(db: Database, roomId: string, you: PlayerId): void {
  useEffect(() => {
    if (!roomId) return;
    return subscribeToConnection(db, (connected) => {
      if (!connected) return;
      setupPresence(db, roomId, you).catch((err: unknown) => {
        console.error("[usePresence] failed to announce presence", err);
      });
    });
  }, [db, roomId, you]);
}
