import { get, ref, serverTimestamp, set, update, onValue, type Database } from "firebase/database";
import type { PlayerId } from "../engine/types";

export async function publishTurnStarted(db: Database, roomId: string): Promise<void> {
  await set(ref(db, `rooms/${roomId}/meta/turnStartedAt`), serverTimestamp());
}

export function subscribeToTurnStarted(
  db: Database,
  roomId: string,
  callback: (at: number) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/meta/turnStartedAt`);
  return onValue(r, (snapshot) => {
    const value = snapshot.val() as number | null;
    if (value) callback(value);
  });
}

export async function publishDealer(db: Database, roomId: string, dealer: PlayerId): Promise<void> {
  await set(ref(db, `rooms/${roomId}/protocol/dealer`), dealer);
}

export function subscribeToDealer(
  db: Database,
  roomId: string,
  callback: (dealer: PlayerId) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/protocol/dealer`);
  return onValue(r, (snapshot) => {
    const value = snapshot.val() as PlayerId | null;
    if (value) callback(value);
  });
}

export async function publishRematchVote(db: Database, roomId: string, player: PlayerId): Promise<void> {
  await set(ref(db, `rooms/${roomId}/rematch/${player}`), true);
}

export function subscribeToRematch(
  db: Database,
  roomId: string,
  callback: (votes: Partial<Record<PlayerId, boolean>>) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/rematch`);
  return onValue(r, (snapshot) => {
    callback((snapshot.val() as Partial<Record<PlayerId, boolean>>) ?? {});
  });
}

/** Reads/increments under a transaction-free "read then write" — good enough
 *  for this game's low write contention (one increment per game, on the
 *  client that just computed the result). */
export async function incrementScore(db: Database, roomId: string, winner: PlayerId): Promise<void> {
  const snapshot = await get(ref(db, `rooms/${roomId}/score/${winner}`));
  const current = (snapshot.val() as number | null) ?? 0;
  await set(ref(db, `rooms/${roomId}/score/${winner}`), current + 1);
}

export function subscribeToScore(
  db: Database,
  roomId: string,
  callback: (score: Record<PlayerId, number>) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/score`);
  return onValue(r, (snapshot) => {
    const value = (snapshot.val() as Partial<Record<PlayerId, number>>) ?? {};
    callback({ p1: value.p1 ?? 0, p2: value.p2 ?? 0 });
  });
}

export function subscribeToGameNumber(
  db: Database,
  roomId: string,
  callback: (gameNumber: number) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/gameNumber`);
  return onValue(r, (snapshot) => {
    callback((snapshot.val() as number | null) ?? 1);
  });
}

/**
 * Starts the next game in the same room: clears the event and protocol logs
 * and the rematch votes, flips the dealer role, and sets the new game
 * number and turn — all as one multi-path update.
 */
export async function resetForRematch(
  db: Database,
  roomId: string,
  nextDealer: PlayerId,
  nextGameNumber: number,
): Promise<void> {
  await update(ref(db, `rooms/${roomId}`), {
    events: null,
    protocol: { dealer: nextDealer },
    rematch: null,
    gameNumber: nextGameNumber,
    "meta/turn": nextDealer,
    "meta/turnStartedAt": serverTimestamp(),
  });
}
