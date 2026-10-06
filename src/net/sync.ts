import {
  get,
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

export type PublishOptions = {
  /** The event's position in the game's total order: the counter's next value. */
  seq: number;
  /** Set when the event changes whose turn it is. */
  nextTurn?: PlayerId;
  /** Pre-generated push key (see {@link newEventKey}). */
  key?: string;
};

/**
 * Appends an event under /rooms/{roomId}/events/{key} carrying `seq`, and in
 * the same multi-path write bumps /meta/eventSeq to `seq` (the rules require
 * `seq == previous counter + 1`, so of two racing writers for the same
 * position only one is accepted; push keys alone are NOT causally ordered
 * across clients). Not a uniqueness guarantee: a single (hostile) update can
 * still carry two events with the same seq, which the intake rejects. When
 * given, also sets /meta/turn. Resolves to the key used.
 */
export async function publishEvent(
  db: Database,
  roomId: string,
  event: GameEvent,
  { seq, nextTurn, key = newEventKey(db, roomId) }: PublishOptions,
): Promise<string> {
  const updates: Record<string, unknown> = {
    [`rooms/${roomId}/events/${key}`]: { ...event, seq },
    [`rooms/${roomId}/meta/eventSeq`]: seq,
  };
  if (nextTurn) {
    updates[`rooms/${roomId}/meta/turn`] = nextTurn;
  }
  await update(ref(db), updates);
  return key;
}

/**
 * A fresh push key for an event, generated locally (no write). Lets a caller
 * know an event's identity BEFORE publishing it, so it can recognise the
 * subscription's echo of its own write (which may arrive before the ack).
 */
export function newEventKey(db: Database, roomId: string): string {
  return push(ref(db, `rooms/${roomId}/events`)).key!;
}

/**
 * Fires `callback` once per event (without its wire `seq`) with its push key
 * and `seq`, including ones already present. Delivery order is NOT the game
 * order: order by `seq`.
 */
export function subscribeToEvents(
  db: Database,
  roomId: string,
  callback: (event: GameEvent, key: string, seq: number) => void,
): () => void {
  const eventsRef = ref(db, `rooms/${roomId}/events`);
  const unsubscribe = onChildAdded(eventsRef, (snapshot) => {
    const { seq, ...event } = snapshot.val() as GameEvent & { seq: number };
    callback(event as GameEvent, snapshot.key!, seq);
  });
  return unsubscribe;
}

/** One-shot read of the room's protocol reveal log (in key order). */
export async function fetchReveals(db: Database, roomId: string): Promise<ProtocolReveal[]> {
  const snapshot = await get(ref(db, `rooms/${roomId}/protocol/reveals`));
  return Object.values((snapshot.val() as Record<string, ProtocolReveal> | null) ?? {});
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

/**
 * Fires `callback` with this client's connection state (Firebase
 * `.info/connected`): on subscribe, then on every drop and reconnect.
 */
export function subscribeToConnection(db: Database, callback: (connected: boolean) => void): () => void {
  return onValue(ref(db, ".info/connected"), (snapshot) => callback(snapshot.val() === true));
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

/** One-shot read of a role's published commitments (null when none yet). */
export async function fetchCommitments(db: Database, roomId: string, role: ProtocolRole): Promise<string[] | null> {
  const snapshot = await get(ref(db, `rooms/${roomId}/protocol/commitments/${role}`));
  return (snapshot.val() as string[] | null) ?? null;
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
  | {
      kind: "placementReveal";
      by: PlayerId;
      /** One batch per player, published once when the reveal phase starts. */
      cards: {
        handIndex: number;
        cardId: string;
        saltHex: string;
        /** Draw index that produced the card; bound to the deck commitment there. */
        drawIndex: number;
        deckSaltHex: string;
      }[];
    };

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
