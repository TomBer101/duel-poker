import { get, ref, serverTimestamp, set, update, type Database } from "firebase/database";

const ROOM_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ROOM_ID_LENGTH = 6;

/** A short, human-shareable room code, e.g. "K3F9QZ". */
export function generateRoomId(): string {
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
  }
  return id;
}

/** SHA-256 of the password salted with the room id, so hashes aren't portable across rooms. */
export async function hashPassword(password: string, roomId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${roomId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Creates a room, seats the creator as p1, and marks them present. `uid` is
 * the creator's Firebase Auth uid, stored on the seat so security rules can
 * confirm a write actually comes from the player occupying it. `turn` starts
 * at "p1" (the dealer/creator), matching the reducer's initial state.
 * Returns the room id.
 *
 * Written as two sequential requests, not one multi-path update: the
 * security rules for `meta` and `presence/p1` read `seats/p1/uid` via
 * `root.child(...)` to confirm the writer is the seated player. In a single
 * multi-location update, the real Realtime Database backend evaluates each
 * touched path's rules against the *pre-write* state of its siblings (the
 * local emulator is more lenient here and allows it in one shot — confirmed
 * by hand against the production database), so `seats/p1` must actually be
 * committed before anything that reads it back can be written.
 */
export async function createRoom(
  db: Database,
  uid: string,
  nick: string,
  password: string,
): Promise<string> {
  const roomId = generateRoomId();
  const passwordHash = await hashPassword(password, roomId);

  await set(ref(db, `rooms/${roomId}/seats/p1`), { nick, uid });
  await update(ref(db, `rooms/${roomId}`), {
    meta: { passwordHash, createdAt: serverTimestamp(), turn: "p1" },
    "presence/p1": true,
  });

  return roomId;
}

/** Seats the joiner as p2 after verifying the password and that the seat is open. */
export async function joinRoom(
  db: Database,
  uid: string,
  roomId: string,
  nick: string,
  password: string,
): Promise<void> {
  const roomSnapshot = await get(ref(db, `rooms/${roomId}`));
  if (!roomSnapshot.exists()) {
    throw new Error(`room ${roomId} does not exist`);
  }
  const room = roomSnapshot.val() as { meta: { passwordHash: string }; seats?: { p2?: unknown } };

  if (room.seats?.p2 !== undefined) {
    throw new Error(`room ${roomId} is full`);
  }

  const passwordHash = await hashPassword(password, roomId);
  if (passwordHash !== room.meta.passwordHash) {
    throw new Error("incorrect password");
  }

  // Sequenced for the same reason as createRoom: presence/p2's rule reads
  // seats/p2/uid back via root, which must already be committed.
  await set(ref(db, `rooms/${roomId}/seats/p2`), { nick, uid });
  await set(ref(db, `rooms/${roomId}/presence/p2`), true);
}
