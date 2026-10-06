import { useEffect, useState } from "react";
import { useFirebaseClient } from "../../app/firebaseContext";
import { createRoom, joinRoom } from "../../net/room";
import { setupPresence, subscribeToPresence } from "../../net/sync";
import { otherPlayer } from "../../engine/deck";
import type { PlayerId } from "../../engine/types";

export type UseLobby = {
  roomId: string | null;
  you: PlayerId | null;
  opponentPresent: boolean;
  error: string | null;
  busy: boolean;
  create: (nick: string, password: string) => Promise<void>;
  join: (roomId: string, nick: string, password: string) => Promise<void>;
};

/** Room creation/joining and opponent-presence tracking for the lobby screen. */
export function useLobby(): UseLobby {
  const { client, uid } = useFirebaseClient();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [you, setYou] = useState<PlayerId | null>(null);
  const [presence, setPresence] = useState<Partial<Record<PlayerId, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    return subscribeToPresence(client.db, roomId, setPresence);
  }, [client.db, roomId]);

  async function create(nick: string, password: string) {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createRoom(client.db, uid, nick, password);
      await setupPresence(client.db, id, "p1");
      setRoomId(id);
      setYou("p1");
      sessionStorage.setItem("duelPoker-you-" + id, "p1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create room");
    } finally {
      setBusy(false);
    }
  }

  async function join(id: string, nick: string, password: string) {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      await joinRoom(client.db, uid, id, nick, password);
      await setupPresence(client.db, id, "p2");
      setRoomId(id);
      setYou("p2");
      sessionStorage.setItem("duelPoker-you-" + id, "p2");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to join room");
    } finally {
      setBusy(false);
    }
  }

  const opponent = you ? otherPlayer(you) : null;
  const opponentPresent = opponent ? presence[opponent] === true : false;

  return { roomId, you, opponentPresent, error, busy, create, join };
}
