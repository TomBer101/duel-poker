import { createElement, useEffect, useState } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, afterAll, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "../../../net/firebase";
import { loadSeed } from "../../../crypto/seedStorage";
import { publishRematchVote, resetForRematch, subscribeToGameNumber } from "../../../net/roomState";
import { createRoom, joinRoom } from "../../../net/room";
import { useMultiplayerGame } from "./useMultiplayerGame";
import { get, goOffline, goOnline, ref, type Database } from "firebase/database";
import type { PlayerId } from "../../../engine/types";
import { publishEvent, publishReveal, setupPresence, type ProtocolReveal } from "../../../net/sync";
import databaseRules from "../../../../database.rules.json";

// The DEAL event schedules 10 staggered `card-place` sfx via real setTimeouts
// (see ui/sound/gameSounds.ts). jsdom doesn't implement HTMLMediaElement.play,
// so those timers firing after the test completes throw uncaught exceptions.
// Sound is irrelevant to this hook's protocol logic, so it's mocked out here
// rather than in production code.
vi.mock("../../sound/gameSounds", () => ({
  playEventSfx: () => {},
  playResultSting: () => {},
}));

// Lets a test deterministically simulate "my own position reveal hasn't
// landed yet" for exactly one draw index, by intercepting the outgoing wire
// write instead of the network's real (near-instant) timing — used by the
// own-hidden-timeout retry/fallback tests below. `mode: "block"` silently
// swallows the write forever (simulates it never arriving); `{ delayMs }`
// forwards it after a delay (simulates ordinary async lateness). Every other
// export of net/sync passes through unchanged.
type PositionRevealControl = { roomId: string; drawIndex: number; mode: "block" | { delayMs: number } } | null;
let positionRevealControl: PositionRevealControl = null;

vi.mock("../../../net/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../net/sync")>();
  return {
    ...actual,
    publishReveal: (db: Database, roomId: string, reveal: ProtocolReveal) => {
      const c = positionRevealControl;
      if (c && reveal.kind === "position" && roomId === c.roomId && reveal.drawIndex === c.drawIndex) {
        if (c.mode === "block") return Promise.resolve();
        const { delayMs } = c.mode;
        return new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            actual.publishReveal(db, roomId, reveal).then(resolve, reject);
          }, delayMs);
        });
      }
      return actual.publishReveal(db, roomId, reveal);
    },
  };
});

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

/** Drives `count` alternating placing turns (p1 first), each client placing
 *  its resolved card on its first legal hand. Shared by the timeout tests
 *  that need to reach a specific turn (e.g. turn 30 = p1's first face-down
 *  turn) without repeating the wait/act boilerplate. */
async function drivePlacingTurns(
  clients: Record<PlayerId, { result: { current: ReturnType<typeof useMultiplayerGame> } }>,
  count: number,
): Promise<void> {
  for (let turn = 0; turn < count; turn++) {
    const active = clients[turn % 2 === 0 ? "p1" : "p2"];
    await waitFor(
      () => {
        expect(active.result.current.state.pendingCard).not.toBeNull();
        expect(active.result.current.legalHands.length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );
    await act(async () => {
      await active.result.current.placePending(active.result.current.legalHands[0]);
    });
  }
}

// --- Real security rules -----------------------------------------------------
// The clients talk to the `test-default-rtdb` namespace (dummyConfig's
// databaseURL). The RTDB emulator applies firebase.json's rules only to the
// project's default instance; any other namespace runs with OPEN rules, so
// without this the rules would never execute here. beforeAll loads the real
// database.rules.json into this namespace with the emulator's admin endpoint
// (the same `PUT /.settings/rules.json?ns=` + `Bearer owner` call that
// @firebase/rules-unit-testing's initializeTestEnvironment makes). The first
// describe block below proves a rule-violating write is actually rejected.
const EMULATOR_DB = "http://127.0.0.1:9000";
const NAMESPACE = new URL(dummyConfig.databaseURL).hostname.split(".")[0];

async function putRules(rules: unknown): Promise<void> {
  const res = await fetch(`${EMULATOR_DB}/.settings/rules.json?ns=${NAMESPACE}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner" },
    body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error(`loading security rules failed: ${await res.text()}`);
}

beforeAll(() => putRules(databaseRules));
// The src/net emulator tests share this namespace and rely on its default
// OPEN rules; restore them so a long-running emulator never leaks the real
// rules into a later suite.
afterAll(() => putRules({ rules: { ".read": true, ".write": true } }));

/** Rules-bypassing write (admin token): stands in for a malicious client that
 *  somehow got a forged message past the server, to test the clients' own
 *  verification as defense in depth. */
async function adminPush(path: string, value: unknown): Promise<void> {
  const res = await fetch(`${EMULATOR_DB}/${path}.json?ns=${NAMESPACE}`, {
    method: "POST",
    headers: { Authorization: "Bearer owner" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`admin write failed: ${await res.text()}`);
}

// Two real clients with distinct anonymous users: p1 creates the room via the
// real createRoom (which also announces p1 as game 1's dealer), p2 joins it.
let db: Database; // p1's client
let db2: Database; // p2's client
let roomId: string;
let appCounter = 0;

beforeEach(async () => {
  const c1 = createFirebaseClient(dummyConfig, `mpgame-p1-${appCounter}`);
  const c2 = createFirebaseClient(dummyConfig, `mpgame-p2-${appCounter}`);
  appCounter++;
  connectToEmulators(c1);
  connectToEmulators(c2);
  const [u1, u2] = await Promise.all([signInAnonymous(c1.auth), signInAnonymous(c2.auth)]);
  db = c1.db;
  db2 = c2.db;
  roomId = await createRoom(db, u1.user.uid, "Alice", "pw");
  await joinRoom(db2, u2.user.uid, roomId, "Bob", "pw");
});

/** Game 1 is dealt by p1 (createRoom). A p2-dealt game is reached the real
 *  way: both players vote for a rematch and the reset hands p2 the deal. */
async function dealtBy(dealer: PlayerId): Promise<void> {
  if (dealer === "p1") return;
  await publishRematchVote(db, roomId, "p1");
  await publishRematchVote(db2, roomId, "p2");
  await resetForRematch(db, roomId, "p2", 2);
}

/**
 * Really disconnects `seat`'s client the way a dropped connection does:
 * registers the production presence hook (setupPresence: onDisconnect ->
 * false), goes offline so the server runs that onDisconnect under the real
 * rules, waits until the other client sees presence false, then reconnects.
 * The reconnect does not re-announce presence (refresh/reconnect recovery is
 * Task 14), so presence stays false and the opponent may claim a FORFEIT,
 * while this client still receives the resulting events.
 */
async function dropConnection(seatDb: Database, seat: PlayerId): Promise<void> {
  await setupPresence(seatDb, roomId, seat);
  goOffline(seatDb);
  const observer = seatDb === db ? db2 : db;
  await waitFor(
    async () => expect((await get(ref(observer, `rooms/${roomId}/presence/${seat}`))).val()).toBe(false),
    { timeout: 5000 },
  );
  goOnline(seatDb);
}

describe("real security rules are enforced in this namespace", () => {
  test("rule-violating writes from the seated clients are rejected", async () => {
    // p2 is the selector in game 1: it may not publish a placementCommit,
    // nor forfeit on its own behalf, nor claim a FORFEIT against a p1 who
    // is still present.
    await expect(
      publishReveal(db2, roomId, { kind: "placementCommit", by: "p2", handIndex: 0, commitment: "0".repeat(64) }),
    ).rejects.toThrow(/permission.denied/i);
    await expect(publishEvent(db2, roomId, { type: "FORFEIT", by: "p2" })).rejects.toThrow(/permission.denied/i);
    await expect(publishEvent(db2, roomId, { type: "FORFEIT", by: "p1" })).rejects.toThrow(/permission.denied/i);
    // ...while legal writes from the same client go through: once p1 has
    // really dropped, the same FORFEIT is accepted.
    await expect(publishRematchVote(db2, roomId, "p2")).resolves.toBeUndefined();
    await dropConnection(db, "p1");
    await expect(publishEvent(db2, roomId, { type: "FORFEIT", by: "p1" })).resolves.toBeUndefined();
  });
});

afterEach(() => {
  positionRevealControl = null;
});

describe("useMultiplayerGame — shuffling and opening deal", () => {
  test("both players end the opening deal with 10 cards dealt, dealer's deck order", async () => {
    const roomId0 = roomId;
    await dealtBy("p1");

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));

    await waitFor(
      () => {
        // Once DEAL lands, the first placing turn's draw may resolve
        // automatically (drawCount 11, pendingCard set) without user input.
        for (const c of [p1, p2]) {
          const { drawCount, pendingCard } = c.result.current.state;
          expect([10, 11]).toContain(drawCount);
          expect(pendingCard === null).toBe(drawCount === 10);
        }
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

    // Each client used its own seed even though both share this jsdom
    // localStorage (seed keys are namespaced by player).
    const seed1 = loadSeed(roomId0, 1, "p1");
    const seed2 = loadSeed(roomId0, 1, "p2");
    expect(seed1).not.toBeNull();
    expect(seed2).not.toBeNull();
    expect(seed1).not.toEqual(seed2);
  });
});

describe("useMultiplayerGame - placing phase", () => {
  test("a full placing phase converges to matching hands on both clients", async () => {
    await dealtBy("p1"); // p1 is dealer, p2 is selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    const clients = { p1, p2 };

    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

    // 40 placing turns. canDraw is always false in multiplayer: wait for the
    // active client's pendingCard (resolved via the reveal chain) and place it.
    for (let turn = 0; turn < 40; turn++) {
      const active = clients[turn % 2 === 0 ? "p1" : "p2"];
      await waitFor(
        () => {
          expect(active.result.current.state.pendingCard).not.toBeNull();
          expect(active.result.current.legalHands.length).toBeGreaterThan(0);
        },
        { timeout: 8000 },
      );
      await act(async () => {
        await active.result.current.placePending(active.result.current.legalHands[0]);
      });
    }

    await waitFor(
      () => {
        expect(p1.result.current.state.phase).toBe("replace");
        expect(p2.result.current.state.phase).toBe("replace");
      },
      { timeout: 8000 },
    );

    // The dealer (p1) resolves its own secret replace draw (index 50) locally,
    // the selector never sees that card, so drawCounts legitimately differ by
    // one here (dealer 51 with a pending card, selector 50).
    await waitFor(() => expect(p1.result.current.state.pendingCard).not.toBeNull(), { timeout: 5000 });
    const a = p1.result.current.state; // dealer's view
    const b = p2.result.current.state; // selector's view
    expect(b.drawCount).toBeGreaterThanOrEqual(50);
    expect(a.drawCount).toBeGreaterThanOrEqual(50);
    expect(a.turn).toBe(b.turn);

    for (const player of ["p1", "p2"] as const) {
      for (let h = 0; h < 5; h++) {
        const ha = a.hands[player][h].cards;
        const hb = b.hands[player][h].cards;
        expect(ha).toHaveLength(5);
        expect(hb).toHaveLength(5);
        for (let c = 0; c < 4; c++) expect(ha[c]).toEqual(hb[c]);
        expect(ha[4].faceUp).toBe(false);
        expect(hb[4].faceUp).toBe(false);
        if (player === "p1") {
          // dealer's secret 5th cards: known to the dealer, hidden from the selector
          expect(ha[4].card).toBeDefined();
          expect(hb[4].card).toBeUndefined();
        } else {
          expect(ha[4].card).toEqual(hb[4].card);
          expect(hb[4].card).toBeDefined();
        }
      }
    }
  }, 60000);
});

describe("useMultiplayerGame - replace and reveal phases", () => {
  async function playToReplace(dealer: PlayerId) {
    await dealtBy(dealer);
    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    const clients = { p1, p2 };
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });
    for (let turn = 0; turn < 40; turn++) {
      const active = clients[turn % 2 === 0 ? "p1" : "p2"];
      await waitFor(
        () => {
          expect(active.result.current.state.pendingCard).not.toBeNull();
          expect(active.result.current.legalHands.length).toBeGreaterThan(0);
        },
        { timeout: 8000 },
      );
      await act(async () => {
        await active.result.current.placePending(active.result.current.legalHands[0]);
      });
    }
    await waitFor(
      () => {
        expect(p1.result.current.state.phase).toBe("replace");
        expect(p2.result.current.state.phase).toBe("replace");
      },
      { timeout: 8000 },
    );
    return clients;
  }

  async function playReplaceAndCheck(dealer: PlayerId, dealerSwap: number | null, selectorSwap: number | null) {
    const clients = await playToReplace(dealer);
    const selector = dealer === "p1" ? "p2" : "p1";
    const order: PlayerId[] = ["p1", "p2"];
    let dealerSecretCardIds: string[] = [];
    for (const who of order) {
      const c = clients[who];
      await waitFor(
        () => {
          expect(c.result.current.state.turn).toBe(who);
          expect(c.result.current.state.phase).toBe("replace");
        },
        { timeout: 8000 },
      );
      // The dealer's own draw resolves from its own deck; the selector's via reveals.
      await waitFor(() => expect(c.result.current.state.pendingCard).not.toBeNull(), { timeout: 8000 });
      const swap = who === dealer ? dealerSwap : selectorSwap;
      await act(async () => {
        await c.result.current.replace(swap);
      });
      if (who === dealer) {
        // Ground truth for the wire scan below: the dealer's own view already
        // knows every one of its 5 secret cards at this point.
        dealerSecretCardIds = clients[dealer].result.current.state.hands[dealer].map(
          (hand) => `${hand.cards[4].card!.suit}-${hand.cards[4].card!.rank}`,
        );
        // Selector's view of the dealer's face-down slots holds no card yet.
        // Only checkable when the dealer moves FIRST: it still has its own
        // turn left afterwards, giving phase="replace" a beat before the
        // dealer's batch (published once phase becomes "reveal") can land. When
        // the dealer moves LAST, replaceDone flips both flags in the same
        // reducer step the phase jumps straight to "reveal" and the batch may
        // already be in flight by the time this assertion runs — that case is
        // instead covered by the final "no card kind reveal ever carries a
        // dealer secret cardId" scan below, which holds regardless of timing.
        if (dealer === "p1") {
          await waitFor(
            () => expect(clients[selector].result.current.state.turn).toBe(selector),
            { timeout: 8000 },
          );
          const dealerHands = clients[selector].result.current.state.hands[dealer];
          for (const hand of dealerHands) expect(hand.cards[4].card).toBeUndefined();
        }
      }
    }
    await waitFor(
      () => {
        expect(clients.p1.result.current.state.result).not.toBeNull();
        expect(clients.p2.result.current.state.result).not.toBeNull();
      },
      { timeout: 10000 },
    );
    expect(clients.p1.result.current.state.result).toEqual(clients.p2.result.current.state.result);
    expect(clients.p1.result.current.hasViolation).toBe(false);
    expect(clients.p2.result.current.hasViolation).toBe(false);
    for (const who of order) {
      for (const player of order) {
        for (const hand of clients[who].result.current.state.hands[player]) {
          expect(hand.cards[4].card).toBeDefined();
        }
      }
    }
    expect(clients.p1.result.current.state.hands).toEqual(clients.p2.result.current.state.hands);

    // Wire check: the dealer never published a card reveal for its 5 face-down
    // placing draws or its own replace draw (52 draws - 6 = 46 card reveals).
    const snap = await get(ref(db, `rooms/${roomId}/protocol/reveals`));
    const all = Object.values(snap.val() as Record<string, ProtocolReveal>);
    expect(all.filter((r) => r.kind === "card")).toHaveLength(46);
    // Exactly one batch per player.
    expect(all.filter((r) => r.kind === "placementReveal" && r.by === dealer)).toHaveLength(1);
    expect(all.filter((r) => r.kind === "placementReveal" && r.by === selector)).toHaveLength(1);
    // Initial 5 commits, plus one per hidden swap.
    expect(all.filter((r) => r.kind === "placementCommit")).toHaveLength(5 + (dealerSwap === null ? 0 : 1));
    // Post-hoc confirmation: the dealer's secret cardIds never leaked as a
    // "card" reveal anywhere in the full transcript either.
    for (const r of all) {
      if (r.kind === "card") expect(dealerSecretCardIds).not.toContain(r.cardId);
    }
  }

  test("dealer (p1) swaps into a hidden slot, selector passes: both reach the same result", async () => {
    await playReplaceAndCheck("p1", 2, null);
  }, 90000);

  test("dealer (p2) passes, selector swaps: both reach the same result", async () => {
    await playReplaceAndCheck("p2", null, 1);
  }, 90000);

  test("dealer (p2) swaps into a hidden slot (secret replace-draw index 51), selector passes", async () => {
    await playReplaceAndCheck("p2", 3, null);
  }, 90000);

  test("a rogue placementCommit (not from the dealer) is a violation on both clients, blocking the reveal", async () => {
    const dealer: PlayerId = "p1";
    const selector: PlayerId = "p2";
    const clients = await playToReplace(dealer);
    for (const who of ["p1", "p2"] as const) {
      if (who === selector) {
        // Inject a forged commit claiming to be from the dealer's own hand 0,
        // but published by the selector — before the dealer's legitimate
        // batch lands. Injected before the selector's (last) replace, so it is
        // committed before the reveal phase can even start. The real rules
        // reject this from the selector's client (see the rules tests), so it
        // goes in with the admin token: this checks the clients' own
        // verification still catches it if it ever got past the server.
        await adminPush(`rooms/${roomId}/protocol/reveals`, {
          kind: "placementCommit",
          by: selector,
          handIndex: 0,
          commitment: "forged-commitment",
        });
      }
      await waitFor(() => expect(clients[who].result.current.state.pendingCard).not.toBeNull(), { timeout: 8000 });
      await act(async () => {
        await clients[who].result.current.replace(null);
      });
    }
    await waitFor(
      () => {
        expect(clients.p1.result.current.hasViolation).toBe(true);
        expect(clients.p2.result.current.hasViolation).toBe(true);
      },
      { timeout: 8000 },
    );
    // A short settle: the violation must permanently block REVEAL_FACE_DOWN.
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The dealer's own client already knows every one of its cards locally
    // (it placed them), so its `result` is computed by the reducer the
    // instant both players finish replacing — independent of REVEAL_FACE_DOWN.
    // Only the selector needs the dealer's verified batch to fill in its
    // blanks, so the violation must keep *its* result null forever.
    expect(clients[selector].result.current.state.phase).toBe("reveal");
    expect(clients[selector].result.current.state.result).toBeNull();
  }, 30000);

  test("a placement reveal batch from an unexpected sender is a violation, not a hang", async () => {
    const dealer: PlayerId = "p1";
    const clients = await playToReplace(dealer);
    for (const who of ["p1", "p2"] as const) {
      await waitFor(() => expect(clients[who].result.current.state.pendingCard).not.toBeNull(), { timeout: 8000 });
      await act(async () => {
        await clients[who].result.current.replace(null);
      });
    }
    await waitFor(() => expect(clients.p1.result.current.state.phase).toBe("reveal"), { timeout: 8000 });
    // A batch claiming to be from a bogus sender — a real client would never
    // publish this, but the wire format doesn't stop a malicious one from trying.
    // The real rules reject it (by must name the writer's seat), so it goes
    // in with the admin token, as above.
    await adminPush(`rooms/${roomId}/protocol/reveals`, {
      kind: "placementReveal",
      by: "p3" as unknown as PlayerId,
      cards: [],
    });
    await waitFor(
      () => {
        expect(clients.p1.result.current.hasViolation).toBe(true);
        expect(clients.p2.result.current.hasViolation).toBe(true);
      },
      { timeout: 8000 },
    );
  }, 30000);
});

describe("useMultiplayerGame - timeout", () => {
  test("a normal-turn timeout: the opponent reports my resolved card, both clients converge", async () => {
    await dealtBy("p1"); // p1 dealer, p2 selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

    // p1's (the dealer's) first turn: a normal, non-face-down placement.
    await waitFor(
      () => {
        expect(p1.result.current.state.pendingCard).not.toBeNull();
        expect(p1.result.current.legalHands.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );

    // It's p1's own turn: p1 timing out itself is a no-op (only the
    // non-active player may ever report a timeout).
    act(() => p1.result.current.timeout());
    expect(p1.result.current.state.strikes).toEqual({ p1: 0, p2: 0 });

    await act(async () => {
      await p1.result.current.placePending(p1.result.current.legalHands[0]);
    });

    // p2's turn now; wait for its card to resolve on both clients (both
    // learn every non-face-down card the same way as a normal draw).
    await waitFor(
      () => {
        expect(p1.result.current.state.turn).toBe("p2");
        expect(p1.result.current.state.pendingCard).not.toBeNull();
        expect(p2.result.current.state.pendingCard).not.toBeNull();
      },
      { timeout: 5000 },
    );

    // p1 (not active) reports p2's timeout with the now-resolved card.
    act(() => p1.result.current.timeout());

    await waitFor(
      () => {
        expect(p1.result.current.state.strikes.p2).toBe(1);
        expect(p2.result.current.state.strikes.p2).toBe(1);
      },
      { timeout: 5000 },
    );

    expect(p1.result.current.state.turn).toBe(p2.result.current.state.turn);
    expect(p1.result.current.state.hands).toEqual(p2.result.current.state.hands);
    expect(p1.result.current.hasViolation).toBe(false);
    expect(p2.result.current.hasViolation).toBe(false);
  }, 30000);

  test("a hidden-turn timeout: the dealer's own face-down turn applies TIMEOUT_HIDDEN on both clients", async () => {
    await dealtBy("p1"); // p1 dealer, p2 selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    const clients = { p1, p2 };
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

    // Drive 30 normal placing turns (p1's own turns 0..14) to reach p1's
    // (the dealer's) first face-down turn (its own turn 15, overall turn 30).
    for (let turn = 0; turn < 30; turn++) {
      const active = clients[turn % 2 === 0 ? "p1" : "p2"];
      await waitFor(
        () => {
          expect(active.result.current.state.pendingCard).not.toBeNull();
          expect(active.result.current.legalHands.length).toBeGreaterThan(0);
        },
        { timeout: 8000 },
      );
      await act(async () => {
        await active.result.current.placePending(active.result.current.legalHands[0]);
      });
    }

    await waitFor(
      () => {
        expect(p1.result.current.state.turn).toBe("p1");
        expect(p2.result.current.state.turn).toBe("p1");
        expect(p1.result.current.state.phase).toBe("placing");
      },
      { timeout: 8000 },
    );
    // The dealer resolves its own secret draw from its own deck; the
    // selector never does — this is exactly the hidden case.
    await waitFor(() => expect(p1.result.current.state.pendingCard).not.toBeNull(), { timeout: 8000 });
    expect(p2.result.current.state.pendingCard).toBeNull();

    // p2 (the selector, not active) reports p1's hidden turn as timed out.
    act(() => p2.result.current.timeout());

    await waitFor(
      () => {
        expect(p1.result.current.state.strikes.p1).toBe(1);
        expect(p2.result.current.state.strikes.p1).toBe(1);
      },
      { timeout: 8000 },
    );

    expect(p1.result.current.state.turn).toBe("p2");
    expect(p2.result.current.state.turn).toBe("p2");

    // The auto-placed hand (fill-evenly picks hand 0 here): a real card on
    // the dealer's own view, card-less on the selector's — same asymmetry
    // as any other face-down placement before the reveal phase.
    const dealerView = p1.result.current.state.hands.p1[0].cards;
    const selectorView = p2.result.current.state.hands.p1[0].cards;
    expect(dealerView).toHaveLength(5);
    expect(selectorView).toHaveLength(5);
    expect(dealerView[4].faceUp).toBe(false);
    expect(selectorView[4].faceUp).toBe(false);
    expect(dealerView[4].card).toBeDefined();
    expect(selectorView[4].card).toBeUndefined();

    expect(p1.result.current.state.drawCount).toBe(p2.result.current.state.drawCount);
    expect(p1.result.current.hasViolation).toBe(false);
    expect(p2.result.current.hasViolation).toBe(false);
  }, 60000);

  test("a hidden-turn timeout arriving before my own position reveal lands: retries, then applies the real card", async () => {
    await dealtBy("p1"); // p1 dealer, p2 selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    const clients = { p1, p2 };
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

    // Delay ONLY the position reveal for draw index 40 (p1's first
    // face-down turn): short enough to comfortably land inside the retry
    // bound (3 x 300ms, plus the downstream apply/dispatch round trip) even
    // with emulator overhead, but long enough that it's virtually certain
    // to still be in flight on the very first check.
    positionRevealControl = { roomId, drawIndex: 40, mode: { delayMs: 150 } };

    await drivePlacingTurns(clients, 30);

    await waitFor(
      () => {
        expect(p1.result.current.state.turn).toBe("p1");
        expect(p2.result.current.state.turn).toBe("p1");
        expect(p1.result.current.state.phase).toBe("placing");
      },
      { timeout: 8000 },
    );
    // p1's own card has NOT resolved yet (the write is still delayed).
    expect(p1.result.current.state.pendingCard).toBeNull();
    expect(p2.result.current.state.pendingCard).toBeNull();

    // p2 reports the timeout immediately, before p1 has any card to translate.
    act(() => p2.result.current.timeout());

    await waitFor(
      () => {
        expect(p1.result.current.state.strikes.p1).toBe(1);
        expect(p2.result.current.state.strikes.p1).toBe(1);
      },
      { timeout: 8000 },
    );

    // The retry caught up once the delayed reveal landed: a real card on
    // p1's own view, not the card-less fallback.
    const dealerView = p1.result.current.state.hands.p1[0].cards;
    const selectorView = p2.result.current.state.hands.p1[0].cards;
    expect(dealerView[4].card).toBeDefined();
    expect(dealerView[4].faceUp).toBe(false);
    expect(selectorView[4].card).toBeUndefined();
    expect(selectorView[4].faceUp).toBe(false);
    expect(p1.result.current.state.drawCount).toBe(p2.result.current.state.drawCount);
    expect(p1.result.current.hasViolation).toBe(false);
    expect(p2.result.current.hasViolation).toBe(false);
  }, 20000);

  test("a hidden-turn timeout whose position reveal never lands: falls back to the card-less TIMEOUT_HIDDEN after the retry bound", async () => {
    await dealtBy("p1"); // p1 dealer, p2 selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    const clients = { p1, p2 };
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

    // Permanently swallow the position reveal for draw index 40: p1 can
    // never resolve its own card for that turn, matching the selector.
    positionRevealControl = { roomId, drawIndex: 40, mode: "block" };

    await drivePlacingTurns(clients, 30);

    await waitFor(
      () => {
        expect(p1.result.current.state.turn).toBe("p1");
        expect(p2.result.current.state.turn).toBe("p1");
        expect(p1.result.current.state.phase).toBe("placing");
      },
      { timeout: 8000 },
    );
    expect(p1.result.current.state.pendingCard).toBeNull();
    expect(p2.result.current.state.pendingCard).toBeNull();

    act(() => p2.result.current.timeout());

    // The retry bound (3 x 300ms) must be exhausted before the fallback
    // lands, so this genuinely waits past it.
    await waitFor(
      () => {
        expect(p1.result.current.state.strikes.p1).toBe(1);
        expect(p2.result.current.state.strikes.p1).toBe(1);
      },
      { timeout: 8000 },
    );

    // Card-less on BOTH clients now: p1 never learned it either.
    const dealerView = p1.result.current.state.hands.p1[0].cards;
    const selectorView = p2.result.current.state.hands.p1[0].cards;
    expect(dealerView[4].card).toBeUndefined();
    expect(dealerView[4].faceUp).toBe(false);
    expect(selectorView[4].card).toBeUndefined();
    expect(selectorView[4].faceUp).toBe(false);
    expect(p1.result.current.state.drawCount).toBe(p2.result.current.state.drawCount);
    expect(p1.result.current.hasViolation).toBe(false);
    expect(p2.result.current.hasViolation).toBe(false);
  }, 20000);

  test("timeout() is a safe no-op before setup completes and on my own turn", async () => {
    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    // Role/dealer not resolved yet (createRoom already announced the dealer,
    // but the hook's dealer subscription has not delivered it on this first
    // render, and p2 is not even mounted): must not throw, must not change
    // anything.
    expect(() => act(() => p1.result.current.timeout())).not.toThrow();
    expect(p1.result.current.state.phase).not.toBe("result");

    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });
    await waitFor(() => expect(p1.result.current.state.pendingCard).not.toBeNull(), { timeout: 5000 });

    // p1 is dealer and it's p1's own turn: it must never self-report.
    const before = p1.result.current.state;
    act(() => p1.result.current.timeout());
    expect(p1.result.current.state).toBe(before);
    expect(p1.result.current.hasViolation).toBe(false);
    void p2; // kept mounted only so the deal/draw pipeline actually runs
  }, 15000);
});

describe("useMultiplayerGame - claimWin (FORFEIT)", () => {
  async function startPlacing() {
    await dealtBy("p1");
    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db: db2, roomId, you: "p2", gameNumber: 1 }));
    await waitFor(
      () => {
        // The initial state is already "placing"; drawCount >= 10 means DEAL landed.
        expect(p1.result.current.state.drawCount).toBeGreaterThanOrEqual(10);
        expect(p2.result.current.state.drawCount).toBeGreaterThanOrEqual(10);
      },
      { timeout: 5000 },
    );
    await dropConnection(db2, "p2");
    return { p1, p2 };
  }

  test("claimer and disconnected client both end in result, forfeitedBy the disconnected seat", async () => {
    const { p1, p2 } = await startPlacing();

    // p1 claims: p2 forfeits. p2's client sees event.by === "p2" === you and
    // must APPLY it (it is not p2's own echo); p1's echo must be ignored.
    act(() => p1.result.current.claimWin());

    await waitFor(
      () => {
        expect(p1.result.current.state.phase).toBe("result");
        expect(p2.result.current.state.phase).toBe("result");
      },
      { timeout: 8000 },
    );
    for (const c of [p1, p2]) {
      expect(c.result.current.state.forfeitedBy).toBe("p2");
      expect(c.result.current.state.result?.winner).toBe("p1");
      expect(c.result.current.hasViolation).toBe(false);
    }
  }, 20000);

  test("claimWin is a no-op once the game is in result", async () => {
    const { p1, p2 } = await startPlacing();
    act(() => p1.result.current.claimWin());
    await waitFor(() => expect(p2.result.current.state.phase).toBe("result"), { timeout: 8000 });
    await waitFor(() => expect(p1.result.current.state.phase).toBe("result"));

    const before = p1.result.current.state;
    act(() => p1.result.current.claimWin());
    act(() => p2.result.current.claimWin()); // would forfeit p1 if not guarded
    expect(p1.result.current.state).toBe(before);
    expect(p2.result.current.state.forfeitedBy).toBe("p2");
    expect(p1.result.current.hasViolation).toBe(false);
    expect(p2.result.current.hasViolation).toBe(false);
  }, 20000);
});

describe("useMultiplayerGame - rematch (real rules, two clients)", () => {
  const read = async (seatDb: Database, path: string) => (await get(ref(seatDb, `rooms/${roomId}/${path}`))).val();

  type Handle = ReturnType<typeof useMultiplayerGame>;
  /** A minimal GameScreen: the hook lives in a body keyed by the room's
   *  gameNumber, so a gameNumber bump REMOUNTS it (new hook instance). */
  function mountKeyed(seatDb: Database, you: PlayerId) {
    const latest: { handle: Handle | null; gameNumbers: number[] } = { handle: null, gameNumbers: [] };
    function Body({ gameNumber }: { gameNumber: number }) {
      useEffect(() => {
        latest.gameNumbers.push(gameNumber);
      }, [gameNumber]);
      latest.handle = useMultiplayerGame({ db: seatDb, roomId, you, gameNumber });
      return null;
    }
    function Shell() {
      const [gameNumber, setGameNumber] = useState<number | null>(null);
      useEffect(() => subscribeToGameNumber(seatDb, roomId, setGameNumber), []);
      return gameNumber === null ? null : createElement(Body, { key: gameNumber, gameNumber });
    }
    render(createElement(Shell));
    return latest;
  }

  test("both vote -> p1 resets the room; the remounted hooks deal game 2 with swapped roles", async () => {
    await dealtBy("p1");
    const p1 = mountKeyed(db, "p1");
    const p2 = mountKeyed(db2, "p2");
    await waitFor(
      () => {
        expect(p1.handle?.state.drawCount).toBeGreaterThanOrEqual(10);
        expect(p2.handle?.state.drawCount).toBeGreaterThanOrEqual(10);
      },
      { timeout: 5000 },
    );
    const game1Commitments = {
      dealer: await read(db, "protocol/commitments/dealer"),
      selector: await read(db, "protocol/commitments/selector"),
    };
    expect(game1Commitments.dealer).not.toBeNull();

    // Fast path to the result phase: p2 drops, p1 claims the forfeit.
    await dropConnection(db2, "p2");
    act(() => p1.handle!.claimWin());
    await waitFor(
      () => {
        expect(p1.handle?.state.phase).toBe("result");
        expect(p2.handle?.state.phase).toBe("result");
      },
      { timeout: 8000 },
    );

    // Both vote from the result screen; a second click publishes nothing new.
    act(() => p2.handle!.playAgain());
    await waitFor(() => expect(p2.handle?.rematchRequested).toBe(true), { timeout: 5000 });
    expect(p1.handle?.rematchRequested).toBe(false);
    act(() => p1.handle!.playAgain());
    act(() => p1.handle!.playAgain());

    // The reset: game 2, dealer flipped, per-game data cleared, new hooks
    // mounted (gameNumber 2) and dealing.
    await waitFor(
      () => {
        expect(p1.gameNumbers).toEqual([1, 2]);
        expect(p2.gameNumbers).toEqual([1, 2]);
        expect(p1.handle?.state.drawCount).toBeGreaterThanOrEqual(10);
        expect(p2.handle?.state.drawCount).toBeGreaterThanOrEqual(10);
        expect(p1.handle?.state.phase).toBe("placing");
      },
      { timeout: 10000 },
    );
    expect(await read(db, "gameNumber")).toBe(2);
    expect(await read(db, "protocol/dealer")).toBe("p2");
    expect(await read(db, "events")).toBeNull();
    expect(await read(db, "rematch")).toBeNull();
    expect(await read(db, "meta/turn")).toBe("p1");
    const reveals = Object.values((await read(db, "protocol/reveals")) as Record<string, ProtocolReveal>);
    // Only game 2's reveals remain: p1 (selector now) published positions 0..9.
    expect(reveals.every((r) => r.kind !== "placementReveal")).toBe(true);
    expect(p1.handle?.rematchRequested).toBe(false);

    // Roles swapped (p2 deals, p1 selects) with fresh seeds => new commitments.
    const game2Dealer = await read(db, "protocol/commitments/dealer");
    const game2Selector = await read(db, "protocol/commitments/selector");
    for (const c1 of [game1Commitments.dealer, game1Commitments.selector]) {
      expect(game2Dealer).not.toEqual(c1);
      expect(game2Selector).not.toEqual(c1);
    }
    expect(loadSeed(roomId, 2, "p1")).not.toEqual(loadSeed(roomId, 1, "p1"));
    expect(p1.handle?.hasViolation).toBe(false);
    expect(p2.handle?.hasViolation).toBe(false);
  }, 60000);
});
