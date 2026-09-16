import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import {
  publishEvent,
  setupPresence,
  subscribeToEvents,
  subscribeToPresence,
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
  test("appends events at increasing indices, readable in order", async () => {
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
    const events = snapshot.val();
    expect(events[0]).toEqual(dealEvent);
    expect(events[1]).toEqual(advanceEvent);
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
