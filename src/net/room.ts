import { get, ref, serverTimestamp, update, type Database } from "firebase/database";

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

/** Creates a room, seats the creator as p1, and marks them present. Returns the room id. */
export async function createRoom(
  db: Database,
  nick: string,
  password: string,
): Promise<string> {
  const roomId = generateRoomId();
  const passwordHash = await hashPassword(password, roomId);

  await update(ref(db, `rooms/${roomId}`), {
    meta: { passwordHash, createdAt: serverTimestamp() },
    "seats/p1": { nick },
    "presence/p1": true,
  });

  return roomId;
}

/** Seats the joiner as p2 after verifying the password and that the seat is open. */
export async function joinRoom(
  db: Database,
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

  await update(ref(db, `rooms/${roomId}`), {
    "seats/p2": { nick },
    "presence/p2": true,
  });
}
