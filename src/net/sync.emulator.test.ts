import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, goOffline, goOnline, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import {
  newEventKey,
  publishEvent,
  setupPresence,
  subscribeToEvents,
  subscribeToPresence,
  subscribeToConnection,
  publishCommitments,
  fetchCommitments,
  publishReveal,
  subscribeToCommitments,
  subscribeToReveals,
  type ProtocolReveal,
} from "./sync";
import type { GameEvent } from "../engine/types";

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
let roomId: string;
let appCounter = 0;

beforeEach(async () => {
  const client = createFirebaseClient(dummyConfig, `sync-test-${appCounter}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
  roomId = `SYNC${appCounter}`;
  appCounter++;
});

describe("publishEvent / subscribeToEvents", () => {
  test("appends events under push keys, readable back in append order", async () => {
    const dealEvent: GameEvent = {
      type: "DEAL",
      cards: {
        p1: [{ suit: "Hearts", rank: 14 }],
        p2: [{ suit: "Spades", rank: 2 }],
      },
    };
    const advanceEvent: GameEvent = { type: "ADVANCE_REVEAL" };

    await publishEvent(db, roomId, dealEvent, { seq: 1 });
    await publishEvent(db, roomId, advanceEvent, { seq: 2 });

    const snapshot = await get(ref(db, `rooms/${roomId}/events`));
    const events = Object.values(snapshot.val() as Record<string, GameEvent>);
    expect(events).toEqual([{ ...dealEvent, seq: 1 }, { ...advanceEvent, seq: 2 }]);
    expect((await get(ref(db, `rooms/${roomId}/meta/eventSeq`))).val()).toBe(2);
  });

  test("optionally updates meta/turn atomically with the event", async () => {
    await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" }, { seq: 1, nextTurn: "p2" });

    const snapshot = await get(ref(db, `rooms/${roomId}/meta/turn`));
    expect(snapshot.val()).toBe("p2");
  });

  test("subscribeToEvents delivers each event once, in append order", async () => {
    const received: GameEvent[] = [];
    const seqs: number[] = [];
    const unsubscribe = subscribeToEvents(db, roomId, (event, _key, seq) => {
      received.push(event);
      seqs.push(seq);
    });

    await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" }, { seq: 1 });
    await publishEvent(db, roomId, { type: "REMATCH", dealer: "p1" }, { seq: 2 });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[0]).toEqual({ type: "ADVANCE_REVEAL" });
    expect(received[1]).toEqual({ type: "REMATCH", dealer: "p1" }); // wire seq stripped
    expect(seqs).toEqual([1, 2]);

    unsubscribe();
  });

  test("publishEvent writes under a supplied key and returns it; subscribers receive that key", async () => {
    const keys: string[] = [];
    const unsubscribe = subscribeToEvents(db, roomId, (_event, key) => {
      keys.push(key);
    });
    const supplied = newEventKey(db, roomId);
    expect(await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" }, { seq: 1, key: supplied })).toBe(supplied);
    const generated = await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" }, { seq: 2 });
    expect(generated).not.toBe(supplied);

    await vi.waitFor(() => expect(keys).toEqual([supplied, generated]));
    const snapshot = await get(ref(db, `rooms/${roomId}/events/${supplied}`));
    expect(snapshot.val()).toEqual({ type: "ADVANCE_REVEAL", seq: 1 });
    unsubscribe();
  });
});

describe("setupPresence / subscribeToPresence", () => {
  test("marks a player present and the subscriber observes it", async () => {
    const updates: Record<string, unknown>[] = [];
    const unsubscribe = subscribeToPresence(db, roomId, (presence) => {
      updates.push(presence);
    });

    await setupPresence(db, roomId, "p1");

    await vi.waitFor(() => {
      expect(updates.at(-1)).toEqual({ p1: true });
    });

    unsubscribe();
  });
});

describe("subscribeToConnection", () => {
  test("reports connected, then the drop, then the reconnect", async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeToConnection(db, (c) => seen.push(c));
    await vi.waitFor(() => expect(seen.at(-1)).toBe(true));
    goOffline(db);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(false));
    goOnline(db);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(true));
    unsubscribe();
  });
});

describe("publishCommitments / subscribeToCommitments", () => {
  test("delivers a role's commitments when they're written", async () => {
    const received: string[][] = [];
    const unsubscribe = subscribeToCommitments(db, roomId, "dealer", (c) => received.push(c));

    await publishCommitments(db, roomId, "dealer", ["h0", "h1"]);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(["h0", "h1"]);
    unsubscribe();
  });

  test("fetchCommitments reads a role's commitments once (null before any)", async () => {
    expect(await fetchCommitments(db, roomId, "selector")).toBeNull();
    await publishCommitments(db, roomId, "selector", ["s0", "s1"]);
    expect(await fetchCommitments(db, roomId, "selector")).toEqual(["s0", "s1"]);
    expect(await fetchCommitments(db, roomId, "dealer")).toBeNull();
  });
});

describe("publishReveal / subscribeToReveals", () => {
  test("delivers reveals in publish order", async () => {
    const received: ProtocolReveal[] = [];
    const unsubscribe = subscribeToReveals(db, roomId, (r) => received.push(r));

    const position: ProtocolReveal = {
      kind: "position",
      by: "p2",
      drawIndex: 0,
      position: 17,
      saltHex: "aa",
    };
    const card: ProtocolReveal = {
      kind: "card",
      by: "p1",
      position: 17,
      cardId: "Spades-7",
      saltHex: "bb",
    };
    await publishReveal(db, roomId, position);
    await publishReveal(db, roomId, card);

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([position, card]);
    unsubscribe();
  });

  test("round-trips a batched placementReveal", async () => {
    const received: ProtocolReveal[] = [];
    const unsubscribe = subscribeToReveals(db, roomId, (r) => received.push(r));
    const batch: ProtocolReveal = {
      kind: "placementReveal",
      by: "p1",
      cards: [
        { handIndex: 0, cardId: "Spades-7", saltHex: "aa", drawIndex: 44, deckSaltHex: "cc" },
        { handIndex: 3, cardId: "Hearts-14", saltHex: "bb", drawIndex: 50, deckSaltHex: "dd" },
      ],
    };
    await publishReveal(db, roomId, batch);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(batch);
    unsubscribe();
  });
});
