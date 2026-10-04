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

// ---------------------------------------------------------------------------
// Phase 7 protocol paths: one table, every rule gets an allowed case and at
// least one denied case. Each case seeds a fresh room (both seats taken, p1 is
// dealer, p1's turn) with rules disabled, applies `seed` tweaks, then performs
// ONE write as `as` (alice = p1, bob = p2, mallory = authenticated but not
// seated, null = unauthenticated).
// ---------------------------------------------------------------------------

type Room = Record<string, unknown> & {
  meta: Record<string, unknown>;
  protocol?: Record<string, unknown>;
};
type Db = ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["database"]>;
type Case = {
  name: string;
  as: "alice" | "bob" | "mallory" | null;
  seed?: (room: Room) => void;
  write: (db: Db) => Promise<unknown>;
  allow: boolean;
};

const UID = { alice: "alice-uid", bob: "bob-uid", mallory: "mallory-uid" } as const;
const TIMESTAMP = { ".sv": "timestamp" };
const hex64 = (i: number) => i.toString(16).padStart(64, "0");
const commitments = (n: number) => Array.from({ length: n }, (_, i) => hex64(i));

function baseRoom(): Room {
  return {
    meta: { passwordHash: "hash", createdAt: 1, turn: "p1" },
    seats: {
      p1: { nick: "Alice", uid: UID.alice },
      p2: { nick: "Bob", uid: UID.bob },
    },
    presence: { p1: true, p2: true },
    protocol: { dealer: "p1" },
  };
}

const at = (path: string) => `rooms/${roomId}/${path}`;
const set = (path: string, value: unknown) => (db: Db) => db.ref(at(path)).set(value);
const push = (path: string, value: unknown) => (db: Db) => db.ref(at(path)).push().set(value);
/** Multi-path update rooted at the room, like publishEvent / resetForRematch. */
const update = (values: Record<string, unknown>) => (db: Db) => db.ref(at("")).update(values);
/** The exact shape publishEvent writes: the event plus meta/turn, in one update. */
const publishEvent = (event: Record<string, unknown>, nextTurn?: string) => (db: Db) =>
  db.ref().update({
    [at("events/pushA")]: event,
    ...(nextTurn ? { [at("meta/turn")]: nextTurn } : {}),
  });
/** The exact shape resetForRematch writes (with optional tweaks / omitted paths). */
const rematchReset = (dealer: string, overrides: Record<string, unknown> = {}, omit: string[] = []) => {
  const values: Record<string, unknown> = {
    events: null,
    protocol: { dealer },
    rematch: null,
    gameNumber: 2,
    "meta/turn": "p1",
    "meta/turnStartedAt": TIMESTAMP,
    ...overrides,
  };
  for (const key of omit) delete values[key];
  return update(values);
};

const bothVoted = (room: Room) => {
  room.rematch = { p1: true, p2: true };
};
const noDealer = (room: Room) => {
  delete room.protocol;
};
const dealerP2 = (room: Room) => {
  room.protocol = { dealer: "p2" };
};
const turn = (who: string) => (room: Room) => {
  room.meta.turn = who;
};
const withGameState = (room: Room) => {
  room.events = { e0: { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false } };
  room.protocol = {
    dealer: "p1",
    commitments: { dealer: commitments(52), selector: commitments(52) },
    reveals: { r0: { kind: "position", by: "p2", drawIndex: 0, position: 3, saltHex: SALT } },
  };
};
/** Marks a seat as disconnected (what its onDisconnect writes). */
const offline = (seat: string) => (room: Room) => {
  (room.presence as Record<string, boolean>)[seat] = false;
};

const SALT = "a".repeat(32); // 16-byte salt as hex
const position = (by: string) => ({ kind: "position", by, drawIndex: 0, position: 7, saltHex: SALT });
const cardReveal = (by: string) => ({ kind: "card", by, position: 7, cardId: "Hearts-2", saltHex: SALT });
const placementCommit = (by: string) => ({ kind: "placementCommit", by, handIndex: 0, commitment: hex64(9) });
const batchEntry = (handIndex: number) => ({ handIndex, cardId: "Hearts-14", saltHex: SALT, drawIndex: 40 + handIndex, deckSaltHex: SALT });
const placementReveal = (by: string, cards: unknown = [batchEntry(0)]) => ({ kind: "placementReveal", by, cards });
const endTurn = (by: string) => ({ type: "END_TURN", by, handIndex: 0, faceDown: false });
const timeoutEv = (card: unknown = { suit: "Hearts", rank: 2 }) => ({ type: "TIMEOUT", by: "p1", card });

const cases: Case[] = [
  // --- protocol/dealer: written once, by p1, as "p1" (createRoom) ---
  { name: "dealer: p1 announces itself on creation", as: "alice", seed: noDealer, write: set("protocol/dealer", "p1"), allow: true },
  {
    name: "dealer: createRoom's second step (meta + presence + dealer in one update)",
    as: "alice",
    seed: (r) => {
      // Only step 1 (seats/p1) is committed so far.
      noDealer(r);
      delete r.presence;
      r.seats = { p1: { nick: "Alice", uid: UID.alice } };
      r.meta = {};
    },
    write: update({
      meta: { passwordHash: "hash", createdAt: TIMESTAMP, turn: "p1" },
      "presence/p1": true,
      "protocol/dealer": "p1",
    }),
    allow: true,
  },
  { name: "dealer: p2 cannot announce the first dealer", as: "bob", seed: noDealer, write: set("protocol/dealer", "p1"), allow: false },
  { name: "dealer: p1 cannot name p2 as the first dealer", as: "alice", seed: noDealer, write: set("protocol/dealer", "p2"), allow: false },
  { name: "dealer: unseated user cannot announce", as: "mallory", seed: noDealer, write: set("protocol/dealer", "p1"), allow: false },
  { name: "dealer: write-once, p1 cannot change it mid-game", as: "alice", write: set("protocol/dealer", "p2"), allow: false },
  { name: "dealer: write-once, p1 cannot delete it", as: "alice", write: set("protocol/dealer", null), allow: false },

  // --- protocol/commitments ---
  { name: "commitments/dealer: the dealer publishes 52 hashes", as: "alice", write: set("protocol/commitments/dealer", commitments(52)), allow: true },
  { name: "commitments/dealer: the selector cannot write them", as: "bob", write: set("protocol/commitments/dealer", commitments(52)), allow: false },
  { name: "commitments/dealer: follows the dealer seat (dealer p2)", as: "bob", seed: dealerP2, write: set("protocol/commitments/dealer", commitments(52)), allow: true },
  { name: "commitments/dealer: write-once", as: "alice", seed: withGameState, write: set("protocol/commitments/dealer", commitments(52)), allow: false },
  { name: "commitments/dealer: 51 hashes is a bad shape", as: "alice", write: set("protocol/commitments/dealer", commitments(51)), allow: false },
  { name: "commitments/dealer: 53 hashes is a bad shape", as: "alice", write: set("protocol/commitments/dealer", commitments(53)), allow: false },
  { name: "commitments/dealer: non-hash entries are a bad shape", as: "alice", write: set("protocol/commitments/dealer", commitments(52).map((h, i) => (i === 5 ? 5 : h))), allow: false },
  { name: "commitments/dealer: unseated user cannot write", as: "mallory", write: set("protocol/commitments/dealer", commitments(52)), allow: false },
  { name: "commitments/selector: the selector publishes 52 hashes", as: "bob", write: set("protocol/commitments/selector", commitments(52)), allow: true },
  { name: "commitments/selector: the dealer cannot write them", as: "alice", write: set("protocol/commitments/selector", commitments(52)), allow: false },
  { name: "commitments/selector: unseated user cannot write", as: "mallory", write: set("protocol/commitments/selector", commitments(52)), allow: false },
  { name: "commitments/selector: nobody is selector before a dealer exists", as: "bob", seed: noDealer, write: set("protocol/commitments/selector", commitments(52)), allow: false },
  { name: "commitments: unknown role key is rejected", as: "alice", write: set("protocol/commitments/other", commitments(52)), allow: false },
  { name: "protocol: unknown child key is rejected", as: "alice", write: set("protocol/junk", "x"), allow: false },

  // --- protocol/reveals/$id ---
  { name: "reveals: the selector publishes a position reveal", as: "bob", write: push("protocol/reveals", position("p2")), allow: true },
  { name: "reveals: the dealer cannot publish a position reveal", as: "alice", write: push("protocol/reveals", position("p1")), allow: false },
  { name: "reveals: a position reveal cannot impersonate the other seat", as: "alice", write: push("protocol/reveals", position("p2")), allow: false },
  { name: "reveals: the dealer publishes a card reveal", as: "alice", write: push("protocol/reveals", cardReveal("p1")), allow: true },
  { name: "reveals: the selector cannot publish a card reveal", as: "bob", write: push("protocol/reveals", cardReveal("p2")), allow: false },
  { name: "reveals: the dealer publishes a placementCommit", as: "alice", write: push("protocol/reveals", placementCommit("p1")), allow: true },
  { name: "reveals: the selector cannot publish a placementCommit", as: "bob", write: push("protocol/reveals", placementCommit("p2")), allow: false },
  { name: "reveals: the selector cannot forge the dealer's placementCommit", as: "bob", write: push("protocol/reveals", placementCommit("p1")), allow: false },
  { name: "reveals: dealer p2 publishes a placementCommit", as: "bob", seed: dealerP2, write: push("protocol/reveals", placementCommit("p2")), allow: true },
  { name: "reveals: selector p1 cannot publish a placementCommit", as: "alice", seed: dealerP2, write: push("protocol/reveals", placementCommit("p1")), allow: false },
  { name: "reveals: the dealer publishes its placementReveal batch", as: "alice", write: push("protocol/reveals", placementReveal("p1")), allow: true },
  { name: "reveals: the selector publishes its placementReveal batch", as: "bob", write: push("protocol/reveals", placementReveal("p2")), allow: true },
  { name: "reveals: a placementReveal from a bogus seat is rejected", as: "bob", write: push("protocol/reveals", placementReveal("p3")), allow: false },
  { name: "reveals: a placementReveal cannot impersonate the other seat", as: "alice", write: push("protocol/reveals", placementReveal("p2")), allow: false },
  { name: "reveals: a card reveal cannot impersonate the dealer", as: "bob", write: push("protocol/reveals", cardReveal("p1")), allow: false },
  { name: "reveals: a full 5-card batch", as: "alice", write: push("protocol/reveals", placementReveal("p1", [0, 1, 2, 3, 4].map(batchEntry))), allow: true },
  { name: "reveals: an oversized (6-entry) batch", as: "alice", write: push("protocol/reveals", placementReveal("p1", [0, 1, 2, 3, 4, 0].map(batchEntry))), allow: false },
  { name: "reveals: a batch entry with an extra key", as: "alice", write: push("protocol/reveals", placementReveal("p1", [{ ...batchEntry(0), faceUp: true }])), allow: false },
  { name: "reveals: a batch entry with a bad cardId", as: "alice", write: push("protocol/reveals", placementReveal("p1", [{ ...batchEntry(0), cardId: "Hearts-1" }])), allow: false },
  { name: "reveals: a batch entry missing its deck salt", as: "alice", write: push("protocol/reveals", placementReveal("p1", [{ handIndex: 0, cardId: "Hearts-2", saltHex: SALT, drawIndex: 40 }])), allow: false },
  { name: "reveals: cards on a non-batch kind", as: "alice", write: push("protocol/reveals", { ...cardReveal("p1"), cards: [batchEntry(0)] }), allow: false },
  { name: "reveals: drawIndex 52 is out of range", as: "bob", write: push("protocol/reveals", { ...position("p2"), drawIndex: 52 }), allow: false },
  { name: "reveals: negative position", as: "bob", write: push("protocol/reveals", { ...position("p2"), position: -1 }), allow: false },
  { name: "reveals: placementCommit with handIndex 7", as: "alice", write: push("protocol/reveals", { ...placementCommit("p1"), handIndex: 7 }), allow: false },
  { name: "reveals: saltHex of the wrong length", as: "bob", write: push("protocol/reveals", { ...position("p2"), saltHex: "ab" }), allow: false },
  { name: "reveals: saltHex that is not hex", as: "bob", write: push("protocol/reveals", { ...position("p2"), saltHex: "z".repeat(32) }), allow: false },
  { name: "reveals: cardId with rank 15", as: "alice", write: push("protocol/reveals", { ...cardReveal("p1"), cardId: "Hearts-15" }), allow: false },
  { name: "reveals: cardId with a bad suit", as: "alice", write: push("protocol/reveals", { ...cardReveal("p1"), cardId: "Stars-2" }), allow: false },
  { name: "reveals: placementCommit with a non-hash commitment", as: "alice", write: push("protocol/reveals", { ...placementCommit("p1"), commitment: "forged" }), allow: false },
  { name: "reveals: write-once (no overwriting an existing reveal)", as: "bob", seed: withGameState, write: set("protocol/reveals/r0", position("p2")), allow: false },
  { name: "reveals: unknown kind is rejected", as: "bob", write: push("protocol/reveals", { kind: "card-ish", by: "p2" }), allow: false },
  { name: "reveals: missing field is a bad shape", as: "bob", write: push("protocol/reveals", { kind: "position", by: "p2", drawIndex: 0, position: 7 }), allow: false },
  { name: "reveals: unknown extra field is a bad shape", as: "bob", write: push("protocol/reveals", { ...position("p2"), extra: 1 }), allow: false },
  { name: "reveals: unseated user cannot write", as: "mallory", write: push("protocol/reveals", position("p2")), allow: false },
  { name: "reveals: unauthenticated client cannot write", as: null, write: push("protocol/reveals", position("p2")), allow: false },

  // --- events/$pushId ---
  { name: "events: END_TURN by the player on turn", as: "alice", write: push("events", endTurn("p1")), allow: true },
  { name: "events: END_TURN in publishEvent's multi-path shape (event + meta/turn)", as: "alice", write: publishEvent(endTurn("p1"), "p2"), allow: true },
  { name: "events: out-of-turn END_TURN", as: "bob", write: publishEvent(endTurn("p2"), "p1"), allow: false },
  { name: "events: END_TURN impersonating the player on turn", as: "bob", write: publishEvent(endTurn("p1"), "p2"), allow: false },
  { name: "events: REPLACE by the player on turn", as: "bob", seed: turn("p2"), write: publishEvent({ type: "REPLACE", by: "p2", handIndex: 1 }, "p1"), allow: true },
  { name: "events: out-of-turn REPLACE", as: "alice", seed: turn("p2"), write: publishEvent({ type: "REPLACE", by: "p1", handIndex: 1 }, "p2"), allow: false },
  { name: "events: TIMEOUT reported by the other seat", as: "bob", write: publishEvent({ type: "TIMEOUT", by: "p1", card: { suit: "Hearts", rank: 2 } }, "p2"), allow: true },
  { name: "events: self-reported TIMEOUT", as: "alice", write: publishEvent({ type: "TIMEOUT", by: "p1", card: { suit: "Hearts", rank: 2 } }, "p2"), allow: false },
  { name: "events: TIMEOUT naming a player who is not on turn", as: "alice", write: publishEvent({ type: "TIMEOUT", by: "p2", card: { suit: "Hearts", rank: 2 } }, "p1"), allow: false },
  { name: "events: TIMEOUT_HIDDEN reported by the other seat", as: "bob", write: publishEvent({ type: "TIMEOUT_HIDDEN", by: "p1" }, "p2"), allow: true },
  { name: "events: TIMEOUT_HIDDEN written by a non-reporter (the timed-out seat)", as: "alice", write: publishEvent({ type: "TIMEOUT_HIDDEN", by: "p1" }, "p2"), allow: false },
  { name: "events: TIMEOUT_HIDDEN by an unseated user", as: "mallory", write: push("events", { type: "TIMEOUT_HIDDEN", by: "p1" }), allow: false },
  { name: "events: FORFEIT naming the disconnected opponent", as: "alice", seed: offline("p2"), write: publishEvent({ type: "FORFEIT", by: "p2" }), allow: true },
  { name: "events: FORFEIT is allowed off-turn too", as: "bob", seed: offline("p1"), write: publishEvent({ type: "FORFEIT", by: "p1" }), allow: true },
  { name: "events: FORFEIT against a present opponent", as: "alice", write: publishEvent({ type: "FORFEIT", by: "p2" }), allow: false },
  { name: "events: FORFEIT against an opponent with no presence node", as: "alice", seed: (r) => { delete (r.presence as Record<string, boolean>).p2; }, write: publishEvent({ type: "FORFEIT", by: "p2" }), allow: false },
  { name: "events: self-reported FORFEIT", as: "alice", seed: offline("p1"), write: publishEvent({ type: "FORFEIT", by: "p1" }), allow: false },
  { name: "events: FORFEIT by an unseated user", as: "mallory", seed: offline("p1"), write: push("events", { type: "FORFEIT", by: "p1" }), allow: false },
  { name: "events: FORFEIT carries only type and by", as: "alice", seed: offline("p2"), write: publishEvent({ type: "FORFEIT", by: "p2", winner: "p1" }), allow: false },

  // --- events: shapes ---
  { name: "events: REPLACE pass (handIndex dropped as null)", as: "alice", write: publishEvent({ type: "REPLACE", by: "p1" }, "p2"), allow: true },
  { name: "events: REPLACE with handIndex 5", as: "alice", write: publishEvent({ type: "REPLACE", by: "p1", handIndex: 5 }, "p2"), allow: false },
  { name: "events: END_TURN with illegal handIndex 7", as: "alice", write: publishEvent({ ...endTurn("p1"), handIndex: 7 }, "p2"), allow: false },
  { name: "events: END_TURN with fractional handIndex", as: "alice", write: publishEvent({ ...endTurn("p1"), handIndex: 1.5 }, "p2"), allow: false },
  { name: "events: END_TURN with non-boolean faceDown", as: "alice", write: publishEvent({ ...endTurn("p1"), faceDown: "yes" }, "p2"), allow: false },
  { name: "events: END_TURN missing faceDown", as: "alice", write: publishEvent({ type: "END_TURN", by: "p1", handIndex: 0 }, "p2"), allow: false },
  { name: "events: END_TURN with an extra key", as: "alice", write: publishEvent({ ...endTurn("p1"), card: { suit: "Hearts", rank: 2 } }, "p2"), allow: false },
  { name: "events: TIMEOUT with a bad rank", as: "bob", write: publishEvent(timeoutEv({ suit: "Hearts", rank: 15 }), "p2"), allow: false },
  { name: "events: TIMEOUT with a bad suit", as: "bob", write: publishEvent(timeoutEv({ suit: "Stars", rank: 2 }), "p2"), allow: false },
  { name: "events: TIMEOUT with an extra card key", as: "bob", write: publishEvent(timeoutEv({ suit: "Hearts", rank: 2, faceUp: true }), "p2"), allow: false },
  { name: "events: TIMEOUT without a card", as: "bob", write: publishEvent({ type: "TIMEOUT", by: "p1" }, "p2"), allow: false },
  { name: "events: TIMEOUT_HIDDEN carrying a card", as: "bob", write: publishEvent({ type: "TIMEOUT_HIDDEN", by: "p1", card: { suit: "Hearts", rank: 2 } }, "p2"), allow: false },
  { name: "events: removed type DEAL", as: "alice", write: push("events", { type: "DEAL", by: "p1" }), allow: false },
  { name: "events: removed type DRAW", as: "alice", write: push("events", { type: "DRAW", by: "p1", card: { suit: "Hearts", rank: 2 } }), allow: false },
  { name: "events: removed type REPLACE_DRAW", as: "alice", write: push("events", { type: "REPLACE_DRAW", by: "p1", card: { suit: "Hearts", rank: 2 } }), allow: false },
  { name: "events: removed type ADVANCE_REVEAL", as: "alice", write: push("events", { type: "ADVANCE_REVEAL" }), allow: false },
  { name: "events: removed type REMATCH", as: "alice", write: push("events", { type: "REMATCH", dealer: "p2" }), allow: false },
  { name: "events: write-once (no overwriting an existing event)", as: "alice", seed: withGameState, write: set("events/e0", endTurn("p1")), allow: false },
  { name: "events: unseated user cannot publish a turn event", as: "mallory", write: push("events", endTurn("p1")), allow: false },
  { name: "events: unauthenticated client cannot publish", as: null, write: push("events", endTurn("p1")), allow: false },

  // --- meta/turnStartedAt ---
  { name: "turnStartedAt: a seated player stamps server time", as: "bob", write: set("meta/turnStartedAt", TIMESTAMP), allow: true },
  { name: "turnStartedAt: a client-chosen time is rejected", as: "alice", write: set("meta/turnStartedAt", 12345), allow: false },
  { name: "turnStartedAt: unseated user cannot write", as: "mallory", write: set("meta/turnStartedAt", TIMESTAMP), allow: false },
  { name: "meta: unknown child key is rejected", as: "alice", write: set("meta/junk", 1), allow: false },

  // --- rematch/$p ---
  { name: "rematch: a player votes for itself", as: "alice", write: set("rematch/p1", true), allow: true },
  { name: "rematch: a player cannot vote for the other seat", as: "alice", write: set("rematch/p2", true), allow: false },
  { name: "rematch: a vote must be true", as: "alice", write: set("rematch/p1", false), allow: false },
  { name: "rematch: a single vote cannot be deleted", as: "alice", seed: bothVoted, write: set("rematch/p1", null), allow: false },
  { name: "rematch: unseated user cannot vote", as: "mallory", write: set("rematch/p1", true), allow: false },

  // --- gameNumber (only during a rematch reset, +1 each time; absent = game 1) ---
  { name: "gameNumber: absent -> 2 in the full reset", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2"), allow: true },
  { name: "gameNumber: 2 -> 3 in the full reset", as: "bob", seed: (r) => { withGameState(r); bothVoted(r); r.gameNumber = 2; r.protocol!.dealer = "p2"; }, write: rematchReset("p1", { gameNumber: 3 }), allow: true },
  { name: "gameNumber: skipping a number (2 -> 4)", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); r.gameNumber = 2; r.protocol!.dealer = "p2"; }, write: rematchReset("p1", { gameNumber: 4 }), allow: false },
  { name: "gameNumber: not a number", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", { gameNumber: "2" }), allow: false },
  { name: "gameNumber: not before both voted", as: "alice", seed: (r) => { withGameState(r); r.rematch = { p1: true }; }, write: rematchReset("p2"), allow: false },
  { name: "gameNumber: unseated user", as: "mallory", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2"), allow: false },

  // --- score/$p (the winner's own client increments its own score by 1) ---
  { name: "score: first win (absent -> 1)", as: "alice", write: set("score/p1", 1), allow: true },
  { name: "score: increment (2 -> 3)", as: "bob", seed: (r) => { r.score = { p2: 2 }; }, write: set("score/p2", 3), allow: true },
  { name: "score: skipping a number (absent -> 2)", as: "alice", write: set("score/p1", 2), allow: false },
  { name: "score: cannot write the other seat's score", as: "alice", write: set("score/p2", 1), allow: false },
  { name: "score: cannot decrement", as: "alice", seed: (r) => { r.score = { p1: 2 }; }, write: set("score/p1", 1), allow: false },
  { name: "score: cannot delete", as: "alice", seed: (r) => { r.score = { p1: 2 }; }, write: set("score/p1", null), allow: false },
  { name: "score: unseated user", as: "mallory", write: set("score/p1", 1), allow: false },

  // --- rematch reset (resetForRematch's multi-path update) ---
  { name: "reset: after both votes, the full reset succeeds", as: "bob", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2"), allow: true },
  { name: "reset: partial reset, deleting events alone", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("events", null), allow: false },
  { name: "reset: partial reset, protocol alone", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("protocol", { dealer: "p2" }), allow: false },
  { name: "reset: partial reset, gameNumber alone", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("gameNumber", 2), allow: false },
  { name: "reset: partial reset, rematch votes alone", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("rematch", null), allow: false },
  { name: "reset: leaving the rematch votes in place", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", {}, ["rematch"]), allow: false },
  { name: "reset: keeping the events log", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", {}, ["events"]), allow: false },
  { name: "reset: without bumping gameNumber", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", {}, ["gameNumber"]), allow: false },
  { name: "reset: skipping a gameNumber", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", { gameNumber: 3 }), allow: false },
  { name: "reset: a second reset once the votes are cleared", as: "alice", seed: (r) => { r.gameNumber = 2; r.protocol = { dealer: "p2" }; }, write: rematchReset("p1", { gameNumber: 3 }), allow: false },
  { name: "reset: before any vote", as: "alice", seed: withGameState, write: rematchReset("p2"), allow: false },
  { name: "reset: with only one vote", as: "alice", seed: (r) => { withGameState(r); r.rematch = { p1: true }; }, write: rematchReset("p2"), allow: false },
  { name: "reset: deleting events before both votes", as: "alice", seed: withGameState, write: set("events", null), allow: false },
  { name: "reset: deleting protocol before both votes", as: "alice", seed: withGameState, write: set("protocol", { dealer: "p2" }), allow: false },
  { name: "reset: deleting rematch votes before both votes", as: "alice", seed: (r) => { r.rematch = { p1: true }; }, write: set("rematch", null), allow: false },
  { name: "reset: an unseated user cannot reset", as: "mallory", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2"), allow: false },
  { name: "reset: the dealer must alternate", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p1"), allow: false },
  { name: "reset: the new dealer must be a seat", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p3"), allow: false },
  { name: "reset: cannot smuggle reveals into the fresh protocol", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: rematchReset("p2", { protocol: { dealer: "p2", reveals: { x: placementCommit("p1") } } }), allow: false },
  { name: "reset: cannot overwrite events wholesale after both votes", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("events", { forged: endTurn("p2") }), allow: false },
  { name: "reset: votes do not reopen write-once commitments", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("protocol/commitments/dealer", commitments(52)), allow: false },
  { name: "reset: votes do not reopen write-once reveals", as: "alice", seed: (r) => { withGameState(r); bothVoted(r); }, write: set("protocol/reveals/r0", cardReveal("p1")), allow: false },
];

describe("Phase 7 protocol rules", () => {
  test.each(cases)("$name", async ({ as, seed, write, allow }) => {
    const room = baseRoom();
    seed?.(room);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(at("")).set(room);
    });
    const db = as === null ? testEnv.unauthenticatedContext().database() : testEnv.authenticatedContext(UID[as]).database();
    await (allow ? assertSucceeds(write(db)) : assertFails(write(db)));
  });

  // Known open items, scheduled separately (not asserted either way here).
  test.todo("meta/turn may only flip to the other seat (Task 16)");
  test.todo("TIMEOUT/TIMEOUT_HIDDEN denied before the turn deadline (Task 16)");
});
