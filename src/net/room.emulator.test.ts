import { beforeEach, describe, expect, test } from "vitest";
import { get, ref, set, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import { createRoom, findSeat, joinRoom, leaveRoom } from "./room";

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
let uid: string;
let appCounter = 0;

beforeEach(async () => {
  const client = createFirebaseClient(dummyConfig, `room-test-${appCounter++}`);
  connectToEmulators(client);
  const credential = await signInAnonymous(client.auth);
  db = client.db;
  uid = credential.user.uid;
});

describe("createRoom", () => {
  test("seats the creator as p1 with their uid, marks them present, sets turn to p1, and announces p1 as dealer", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");

    expect(roomId).toMatch(/^[A-Z0-9]{6}$/);
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const room = snapshot.val();
    expect(room.seats.p1).toEqual({ nick: "Alice", uid });
    expect(room.presence.p1).toBe(true);
    expect(room.seats.p2).toBeUndefined();
    expect(room.meta.turn).toBe("p1");
    expect(room.protocol.dealer).toBe("p1");
  });
});

describe("joinRoom", () => {
  test("seats the joiner as p2 with their uid when the password matches", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");
    const joinerUid = "bob-uid";

    await joinRoom(db, joinerUid, roomId, "Bob", "hunter2");

    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const room = snapshot.val();
    expect(room.seats.p2).toEqual({ nick: "Bob", uid: joinerUid });
    expect(room.presence.p2).toBe(true);
  });

  test("rejects an incorrect password", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");

    await expect(joinRoom(db, "bob-uid", roomId, "Bob", "wrong")).rejects.toThrow(
      "incorrect password",
    );
  });

  test("rejects joining a room that already has a p2", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");
    await joinRoom(db, "bob-uid", roomId, "Bob", "hunter2");

    await expect(
      joinRoom(db, "carol-uid", roomId, "Carol", "hunter2"),
    ).rejects.toThrow(`room ${roomId} is full`);
  });

  test("rejects joining a room that does not exist", async () => {
    await expect(joinRoom(db, "bob-uid", "NOROOM", "Bob", "hunter2")).rejects.toThrow(
      "does not exist",
    );
  });
});

describe("findSeat", () => {
  test("finds each seat by uid; a stranger or a missing room has none", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");
    await joinRoom(db, "bob-uid", roomId, "Bob", "hunter2");

    expect(await findSeat(db, roomId, uid)).toBe("p1");
    expect(await findSeat(db, roomId, "bob-uid")).toBe("p2");
    expect(await findSeat(db, roomId, "carol-uid")).toBeNull();
    expect(await findSeat(db, "NOROOM", uid)).toBeNull();
  });
});

describe("leaveRoom", () => {
  const roomExists = async (roomId: string) => (await get(ref(db, `rooms/${roomId}`))).exists();

  test("a lone p1 leaving deletes the room", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");

    await leaveRoom(db, roomId, "p1");

    expect(await roomExists(roomId)).toBe(false);
  });

  test("the first leaver only flags the seat; the second leaver deletes the room", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");
    await joinRoom(db, "bob-uid", roomId, "Bob", "hunter2");

    await leaveRoom(db, roomId, "p2");
    expect((await get(ref(db, `rooms/${roomId}/left`))).val()).toEqual({ p2: true });
    expect((await get(ref(db, `rooms/${roomId}/presence/p2`))).val()).toBe(false);

    await leaveRoom(db, roomId, "p1");
    expect(await roomExists(roomId)).toBe(false);
  });

  test("leaving after the other player went offline deletes the room", async () => {
    const roomId = await createRoom(db, uid, "Alice", "hunter2");
    await joinRoom(db, "bob-uid", roomId, "Bob", "hunter2");
    await set(ref(db, `rooms/${roomId}/presence/p2`), false);

    await leaveRoom(db, roomId, "p1");

    expect(await roomExists(roomId)).toBe(false);
  });

  test("leaving a room that is already gone is a no-op", async () => {
    await expect(leaveRoom(db, "NOROOM", "p1")).resolves.toBeUndefined();
  });
});
