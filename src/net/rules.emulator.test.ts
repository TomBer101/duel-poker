import { afterAll, afterEach, beforeAll, describe, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import databaseRules from "../../database.rules.json";

// Exercises database.rules.json directly (not room.ts/sync.ts, which already
// have their own emulator tests) — these tests ask "does the server actually
// reject what it should?", independent of what our own client code happens
// to send.

let testEnv: RulesTestEnvironment;
const roomId = "RULES1";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "test-project",
    database: {
      rules: JSON.stringify(databaseRules),
      host: "127.0.0.1",
      port: 9000,
    },
  });
});

afterEach(async () => {
  await testEnv.clearDatabase();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedRoom(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`rooms/${roomId}`).set({
      meta: { passwordHash: "hash", createdAt: 1, turn: "p1" },
      seats: { p1: { nick: "Alice", uid: "alice-uid" } },
      presence: { p1: true },
    });
  });
}

async function seedRoomWithBothSeated(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`rooms/${roomId}`).set({
      meta: { passwordHash: "hash", createdAt: 1, turn: "p1" },
      seats: {
        p1: { nick: "Alice", uid: "alice-uid" },
        p2: { nick: "Bob", uid: "bob-uid" },
      },
      presence: { p1: true, p2: true },
    });
  });
}

describe("auth requirement", () => {
  test("an unauthenticated client cannot read a room", async () => {
    await seedRoom();
    const db = testEnv.unauthenticatedContext().database();
    await assertFails(db.ref(`rooms/${roomId}`).get());
  });
});

describe("seats", () => {
  test("an authenticated user can claim an empty p1 seat with their own uid", async () => {
    const db = testEnv.authenticatedContext("alice-uid").database();
    await assertSucceeds(
      db.ref(`rooms/${roomId}/seats/p1`).set({ nick: "Alice", uid: "alice-uid" }),
    );
  });

  test("cannot claim a seat using someone else's uid", async () => {
    const db = testEnv.authenticatedContext("alice-uid").database();
    await assertFails(
      db.ref(`rooms/${roomId}/seats/p1`).set({ nick: "Alice", uid: "not-alice" }),
    );
  });

  test("cannot claim p2 before p1 exists", async () => {
    const db = testEnv.authenticatedContext("bob-uid").database();
    await assertFails(
      db.ref(`rooms/${roomId}/seats/p2`).set({ nick: "Bob", uid: "bob-uid" }),
    );
  });

  test("a second player can claim p2 once p1 exists", async () => {
    await seedRoom();
    const db = testEnv.authenticatedContext("bob-uid").database();
    await assertSucceeds(
      db.ref(`rooms/${roomId}/seats/p2`).set({ nick: "Bob", uid: "bob-uid" }),
    );
  });

  test("cannot overwrite an already-occupied p2 seat", async () => {
    await seedRoomWithBothSeated();
    const db = testEnv.authenticatedContext("carol-uid").database();
    await assertFails(
      db.ref(`rooms/${roomId}/seats/p2`).set({ nick: "Carol", uid: "carol-uid" }),
    );
  });
});

describe("presence", () => {
  test("the seated player can write their own presence", async () => {
    await seedRoom();
    const db = testEnv.authenticatedContext("alice-uid").database();
    await assertSucceeds(db.ref(`rooms/${roomId}/presence/p1`).set(true));
  });

  test("a different uid cannot write someone else's presence", async () => {
    await seedRoom();
    const db = testEnv.authenticatedContext("mallory-uid").database();
    await assertFails(db.ref(`rooms/${roomId}/presence/p1`).set(true));
  });
});

describe("events — turn gating", () => {
  test("the player whose turn it is can publish an END_TURN event", async () => {
    await seedRoomWithBothSeated();
    const db = testEnv.authenticatedContext("alice-uid").database();
    await assertSucceeds(
      db
        .ref(`rooms/${roomId}/events`)
        .push()
        .set({ type: "END_TURN", by: "p1", handIndex: 0, faceDown: false }),
    );
  });

  test("the player who is NOT on turn cannot publish a turn event", async () => {
    await seedRoomWithBothSeated();
    const db = testEnv.authenticatedContext("bob-uid").database();
    await assertFails(
      db
        .ref(`rooms/${roomId}/events`)
        .push()
        .set({ type: "END_TURN", by: "p2", handIndex: 0, faceDown: false }),
    );
  });

  test("a seated player cannot publish a turn event impersonating the other seat", async () => {
    await seedRoomWithBothSeated();
    // Bob (p2) tries to write an event claiming to be p1's action.
    const db = testEnv.authenticatedContext("bob-uid").database();
    await assertFails(
      db
        .ref(`rooms/${roomId}/events`)
        .push()
        .set({ type: "END_TURN", by: "p1", handIndex: 0, faceDown: false }),
    );
  });

  test("only the non-active player can publish a TIMEOUT for the active player", async () => {
    await seedRoomWithBothSeated();
    // meta.turn is p1, so p1 (Alice) is the active/timed-out player; only
    // Bob (p2) may publish the TIMEOUT on her behalf.
    const bobDb = testEnv.authenticatedContext("bob-uid").database();
    await assertSucceeds(
      bobDb
        .ref(`rooms/${roomId}/events`)
        .push()
        .set({ type: "TIMEOUT", by: "p1", card: { suit: "Hearts", rank: 2 } }),
    );

    const aliceDb = testEnv.authenticatedContext("alice-uid").database();
    await assertFails(
      aliceDb
        .ref(`rooms/${roomId}/events`)
        .push()
        .set({ type: "TIMEOUT", by: "p1", card: { suit: "Hearts", rank: 2 } }),
    );
  });

  test("any seated player can publish a turn-agnostic event like ADVANCE_REVEAL", async () => {
    await seedRoomWithBothSeated();
    const db = testEnv.authenticatedContext("bob-uid").database();
    await assertSucceeds(
      db.ref(`rooms/${roomId}/events`).push().set({ type: "ADVANCE_REVEAL" }),
    );
  });

  test("an unseated authenticated user cannot publish any event", async () => {
    await seedRoomWithBothSeated();
    const db = testEnv.authenticatedContext("mallory-uid").database();
    await assertFails(
      db.ref(`rooms/${roomId}/events`).push().set({ type: "ADVANCE_REVEAL" }),
    );
  });
});
