import {
  onChildAdded,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  set,
  type Database,
} from "firebase/database";
import type { GameEvent, PlayerId } from "../engine/types";

/** Appends an event at the next index under /rooms/{roomId}/events, atomically. */
export async function publishEvent(
  db: Database,
  roomId: string,
  event: GameEvent,
): Promise<void> {
  await runTransaction(ref(db, `rooms/${roomId}/events`), (events: GameEvent[] | null) => {
    const next = events ? [...events] : [];
    next.push(event);
    return next;
  });
}

/** Fires `callback` once per event, in append order, including ones already present. */
export function subscribeToEvents(
  db: Database,
  roomId: string,
  callback: (event: GameEvent) => void,
): () => void {
  const eventsRef = ref(db, `rooms/${roomId}/events`);
  const unsubscribe = onChildAdded(eventsRef, (snapshot) => {
    callback(snapshot.val() as GameEvent);
  });
  return unsubscribe;
}

/** Marks `player` present in the room and clears it automatically on disconnect. */
export async function setupPresence(
  db: Database,
  roomId: string,
  player: PlayerId,
): Promise<void> {
  const presenceRef = ref(db, `rooms/${roomId}/presence/${player}`);
  await onDisconnect(presenceRef).set(false);
  await set(presenceRef, true);
}

/** Fires `callback` with the room's full presence map whenever it changes. */
export function subscribeToPresence(
  db: Database,
  roomId: string,
  callback: (presence: Partial<Record<PlayerId, boolean>>) => void,
): () => void {
  const presenceRef = ref(db, `rooms/${roomId}/presence`);
  const unsubscribe = onValue(presenceRef, (snapshot) => {
    callback((snapshot.val() as Partial<Record<PlayerId, boolean>>) ?? {});
  });
  return unsubscribe;
}
