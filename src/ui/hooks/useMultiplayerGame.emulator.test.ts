import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, beforeEach, vi } from "vitest";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "../../net/firebase";
import { loadSeed } from "../../crypto/seedStorage";
import { publishDealer } from "../../net/roomState";
import { useMultiplayerGame } from "./useMultiplayerGame";
import { get, ref, type Database } from "firebase/database";
import type { PlayerId } from "../../engine/types";
import { publishReveal, type ProtocolReveal } from "../../net/sync";

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
    await publishDealer(db, roomId, "p1"); // p1 is dealer, p2 is selector

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));
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
    await publishDealer(db, roomId, dealer);
    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));
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
      await waitFor(() => expect(clients[who].result.current.state.pendingCard).not.toBeNull(), { timeout: 8000 });
      await act(async () => {
        await clients[who].result.current.replace(null);
      });
    }
    // Inject a forged commit claiming to be from the dealer's own hand 0, but
    // published by the selector — before the dealer's legitimate batch lands.
    await publishReveal(db, roomId, {
      kind: "placementCommit",
      by: selector,
      handIndex: 0,
      commitment: "forged-commitment",
    });
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
    await publishReveal(db, roomId, {
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
