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

export type ProtocolRole = "dealer" | "selector";

/** Publishes one role's 52 commitment hashes for the current game's shuffle. */
export async function publishCommitments(
  db: Database,
  roomId: string,
  role: ProtocolRole,
  commitments: string[],
): Promise<void> {
  await set(ref(db, `rooms/${roomId}/protocol/commitments/${role}`), commitments);
}

/** Fires `callback` with a role's commitments whenever they're written. */
export function subscribeToCommitments(
  db: Database,
  roomId: string,
  role: ProtocolRole,
  callback: (commitments: string[]) => void,
): () => void {
  const commitmentsRef = ref(db, `rooms/${roomId}/protocol/commitments/${role}`);
  return onValue(commitmentsRef, (snapshot) => {
    const value = snapshot.val() as string[] | null;
    if (value) callback(value);
  });
}

/**
 * One commit-reveal wire message. `position`/`card` reveal a draw index's
 * deck position and the card at it (verified independently — see
 * `protocolController.ts`). `placementCommit`/`placementReveal` cover the
 * dealer's face-down 5th card, which the dealer already knows and places
 * secretly: a hash now, the real card only in the reveal phase.
 */
export type ProtocolReveal =
  | { kind: "position"; by: PlayerId; drawIndex: number; position: number; saltHex: string }
  | { kind: "card"; by: PlayerId; position: number; cardId: string; saltHex: string }
  | { kind: "placementCommit"; by: PlayerId; handIndex: number; commitment: string }
  | { kind: "placementReveal"; by: PlayerId; handIndex: number; cardId: string; saltHex: string };

/** Appends a protocol message under /rooms/{roomId}/protocol/reveals. */
export async function publishReveal(
  db: Database,
  roomId: string,
  reveal: ProtocolReveal,
): Promise<void> {
  const revealRef = push(ref(db, `rooms/${roomId}/protocol/reveals`));
  await set(revealRef, reveal);
}

/** Fires `callback` once per protocol message, in append order. */
export function subscribeToReveals(
  db: Database,
  roomId: string,
  callback: (reveal: ProtocolReveal) => void,
): () => void {
  const revealsRef = ref(db, `rooms/${roomId}/protocol/reveals`);
  return onChildAdded(revealsRef, (snapshot) => {
    callback(snapshot.val() as ProtocolReveal);
  });
}
