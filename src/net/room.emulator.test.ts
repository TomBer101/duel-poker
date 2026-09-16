import { beforeEach, describe, expect, test } from "vitest";
import { get, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import { createRoom, joinRoom } from "./room";

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

let db: Database;
let appCounter = 0;

beforeEach(async () => {
  const client = createFirebaseClient(dummyConfig, `room-test-${appCounter++}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
});

describe("createRoom", () => {
  test("seats the creator as p1 and marks them present", async () => {
    const roomId = await createRoom(db, "Alice", "hunter2");

    expect(roomId).toMatch(/^[A-Z0-9]{6}$/);
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const room = snapshot.val();
    expect(room.seats.p1).toEqual({ nick: "Alice" });
    expect(room.presence.p1).toBe(true);
    expect(room.seats.p2).toBeUndefined();
  });
});

describe("joinRoom", () => {
  test("seats the joiner as p2 when the password matches", async () => {
    const roomId = await createRoom(db, "Alice", "hunter2");

    await joinRoom(db, roomId, "Bob", "hunter2");

    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const room = snapshot.val();
    expect(room.seats.p2).toEqual({ nick: "Bob" });
    expect(room.presence.p2).toBe(true);
  });

  test("rejects an incorrect password", async () => {
    const roomId = await createRoom(db, "Alice", "hunter2");

    await expect(joinRoom(db, roomId, "Bob", "wrong")).rejects.toThrow(
      "incorrect password",
    );
  });

  test("rejects joining a room that already has a p2", async () => {
    const roomId = await createRoom(db, "Alice", "hunter2");
    await joinRoom(db, roomId, "Bob", "hunter2");

    await expect(joinRoom(db, roomId, "Carol", "hunter2")).rejects.toThrow(
      `room ${roomId} is full`,
    );
  });

  test("rejects joining a room that does not exist", async () => {
    await expect(joinRoom(db, "NOROOM", "Bob", "hunter2")).rejects.toThrow(
      "does not exist",
    );
  });
});
