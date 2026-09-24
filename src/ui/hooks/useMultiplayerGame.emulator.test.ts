import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, beforeEach, vi } from "vitest";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "../../net/firebase";
import { loadSeed } from "../../crypto/seedStorage";
import { publishDealer } from "../../net/roomState";
import { useMultiplayerGame } from "./useMultiplayerGame";
import type { Database } from "firebase/database";

// The DEAL event schedules 10 staggered `card-place` sfx via real setTimeouts
// (see ui/sound/gameSounds.ts). jsdom doesn't implement HTMLMediaElement.play,
// so those timers firing after the test completes throw uncaught exceptions.
// Sound is irrelevant to this hook's protocol logic, so it's mocked out here
// rather than in production code.
vi.mock("../sound/gameSounds", () => ({
  playEventSfx: () => {},
  playResultSting: () => {},
}));

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
  const client = createFirebaseClient(dummyConfig, `mpgame-test-${appCounter}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
  roomId = `MPGAME${appCounter}`;
  appCounter++;
});

describe("useMultiplayerGame — shuffling and opening deal", () => {
  test("both players end the opening deal with 10 cards dealt, dealer's deck order", async () => {
    const roomId0 = roomId;
    await publishDealer(db, roomId, "p1");

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));

    await waitFor(
      () => {
        expect(p1.result.current.state.drawCount).toBe(10);
        expect(p2.result.current.state.drawCount).toBe(10);
      },
      { timeout: 5000 },
    );

    // Both clients replayed the same verified deal.
    expect(p1.result.current.state.hands).toEqual(p2.result.current.state.hands);
    expect(p1.result.current.state.phase).toBe("placing");

    // The deal actually populated every hand: 5 hands per player, one
    // face-up card in each (10 cards total).
    for (const player of ["p1", "p2"] as const) {
      const hands = p1.result.current.state.hands[player];
      expect(hands).toHaveLength(5);
      for (const hand of hands) expect(hand.cards).toHaveLength(1);
    }
    expect(p1.result.current.state.pendingCard).toBeNull();

    // Each client used its own seed even though both share this jsdom
    // localStorage (seed keys are namespaced by player).
    const seed1 = loadSeed(roomId0, 1, "p1");
    const seed2 = loadSeed(roomId0, 1, "p2");
    expect(seed1).not.toBeNull();
    expect(seed2).not.toBeNull();
    expect(seed1).not.toEqual(seed2);
  });
});
