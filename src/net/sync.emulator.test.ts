import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import {
  publishEvent,
  setupPresence,
  subscribeToEvents,
  subscribeToPresence,
  publishCommitments,
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

    await publishEvent(db, roomId, dealEvent);
    await publishEvent(db, roomId, advanceEvent);

    const snapshot = await get(ref(db, `rooms/${roomId}/events`));
    const events = Object.values(snapshot.val() as Record<string, GameEvent>);
    expect(events).toEqual([dealEvent, advanceEvent]);
  });

  test("optionally updates meta/turn atomically with the event", async () => {
    await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" }, "p2");

    const snapshot = await get(ref(db, `rooms/${roomId}/meta/turn`));
    expect(snapshot.val()).toBe("p2");
  });

  test("subscribeToEvents delivers each event once, in append order", async () => {
    const received: GameEvent[] = [];
    const unsubscribe = subscribeToEvents(db, roomId, (event) => {
      received.push(event);
    });

    await publishEvent(db, roomId, { type: "ADVANCE_REVEAL" });
    await publishEvent(db, roomId, { type: "REMATCH", dealer: "p1" });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[0]).toEqual({ type: "ADVANCE_REVEAL" });
    expect(received[1]).toEqual({ type: "REMATCH", dealer: "p1" });

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

describe("publishCommitments / subscribeToCommitments", () => {
  test("delivers a role's commitments when they're written", async () => {
    const received: string[][] = [];
    const unsubscribe = subscribeToCommitments(db, roomId, "dealer", (c) => received.push(c));

    await publishCommitments(db, roomId, "dealer", ["h0", "h1"]);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(["h0", "h1"]);
    unsubscribe();
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
        { handIndex: 0, cardId: "Spades-7", saltHex: "aa" },
        { handIndex: 3, cardId: "Hearts-14", saltHex: "bb" },
      ],
    };
    await publishReveal(db, roomId, batch);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(batch);
    unsubscribe();
  });
});
