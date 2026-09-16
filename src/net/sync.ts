import {
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  set,
  update,
  type Database,
} from "firebase/database";
import type { GameEvent, PlayerId } from "../engine/types";

/**
 * Appends an event under /rooms/{roomId}/events using a Firebase push key
 * (chronologically ordered, collision-free — no two clients can ever
 * generate the same one, so no "next index" arithmetic is needed) and —
 * when the event changes whose turn it is — atomically updates
 * /rooms/{roomId}/meta/turn in the same multi-path write.
 */
export async function publishEvent(
  db: Database,
  roomId: string,
  event: GameEvent,
  nextTurn?: PlayerId,
): Promise<void> {
  const eventRef = push(ref(db, `rooms/${roomId}/events`));

  const updates: Record<string, unknown> = {
    [`rooms/${roomId}/events/${eventRef.key}`]: event,
  };
  if (nextTurn) {
    updates[`rooms/${roomId}/meta/turn`] = nextTurn;
  }
  await update(ref(db), updates);
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
