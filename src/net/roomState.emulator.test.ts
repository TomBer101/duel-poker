import { beforeEach, expect, test, vi } from "vitest";
import { get, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import {
  incrementScore,
  publishDealer,
  publishRematchVote,
  publishTurnStarted,
  resetForRematch,
  subscribeToDealer,
  subscribeToRematch,
  subscribeToScore,
  subscribeToTurnStarted,
} from "./roomState";

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
  const client = createFirebaseClient(dummyConfig, `roomstate-test-${appCounter}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
  roomId = `RSTATE${appCounter}`;
  appCounter++;
});

test("publishTurnStarted sets a server timestamp subscribers observe", async () => {
  // The RTDB client SDK fires onValue twice for a serverTimestamp() write:
  // once immediately with a locally-estimated value, again when the
  // server's real value round-trips back. Real consumers only ever care
  // about the latest value, so the test asserts on `seen.at(-1)`, not on
  // how many times the callback fired.
  const seen: number[] = [];
  const unsubscribe = subscribeToTurnStarted(db, roomId, (at) => seen.push(at));
  await publishTurnStarted(db, roomId);
  await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
  expect(seen.at(-1)).toBeGreaterThan(0);
  unsubscribe();
});

test("publishDealer / subscribeToDealer", async () => {
  const seen: string[] = [];
  const unsubscribe = subscribeToDealer(db, roomId, (d) => seen.push(d));
  await publishDealer(db, roomId, "p2");
  await vi.waitFor(() => expect(seen).toEqual(["p2"]));
  unsubscribe();
});

test("publishRematchVote / subscribeToRematch", async () => {
  const seen: Record<string, boolean>[] = [];
  const unsubscribe = subscribeToRematch(db, roomId, (v) => seen.push(v));
  await publishRematchVote(db, roomId, "p1");
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ p1: true }));
  unsubscribe();
});

test("incrementScore / subscribeToScore accumulates per player", async () => {
  const seen: Record<string, number>[] = [];
  const unsubscribe = subscribeToScore(db, roomId, (s) => seen.push(s));
  await incrementScore(db, roomId, "p1");
  await incrementScore(db, roomId, "p1");
  await incrementScore(db, roomId, "p2");
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ p1: 2, p2: 1 }));
  unsubscribe();
});

test("resetForRematch clears events/protocol/rematch, sets the next dealer, and restarts the turn at p1", async () => {
  await publishRematchVote(db, roomId, "p1");
  await publishRematchVote(db, roomId, "p2");

  await resetForRematch(db, roomId, "p2", 2);

  const rematch = await get(ref(db, `rooms/${roomId}/rematch`));
  expect(rematch.val()).toBeNull();
  const dealer = await get(ref(db, `rooms/${roomId}/protocol/dealer`));
  expect(dealer.val()).toBe("p2");
  const gameNumber = await get(ref(db, `rooms/${roomId}/gameNumber`));
  expect(gameNumber.val()).toBe(2);
  const turn = await get(ref(db, `rooms/${roomId}/meta/turn`));
  // The placing schedule always starts with p1, whoever deals.
  expect(turn.val()).toBe("p1");
});
