import { describe, expect, test } from "vitest";
import {
  applyCardReveal,
  applyPlacementCommit,
  applyPlacementReveal,
  receiveRevealBatch,
  recordHiddenDraw,
  applyPositionReveal,
  commitPlacement,
  createProtocolState,
  hasViolation,
  resolvedDraw,
  setCommitments,
} from "./protocolController";
import { generateDealerCommitments, generateSelectorCommitments } from "./protocol";
import { generateSalt, generateSeed, saltToHex, verify } from "./commitment";
import { cardId } from "../engine/deck";

describe("protocolController", () => {
  test("resolves a draw once both halves verify", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    const selector = await generateSelectorCommitments(generateSeed());

    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);
    state = setCommitments(state, "selector", selector.commitments);

    const drawIndex = 0;
    const position = selector.drawOrder[drawIndex];
    state = await applyPositionReveal(state, drawIndex, position, selector.salts[drawIndex]);
    expect(resolvedDraw(state, drawIndex)).toBeNull(); // card half still missing

    const card = dealer.deck[position];
    state = await applyCardReveal(state, position, card, dealer.salts[position]);

    expect(resolvedDraw(state, drawIndex)).toEqual(card);
    expect(hasViolation(state)).toBe(false);
  });

  test("rejects a tampered position reveal", async () => {
    const selector = await generateSelectorCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "selector", selector.commitments);

    const wrongPosition = (selector.drawOrder[0] + 1) % 52;
    state = await applyPositionReveal(state, 0, wrongPosition, selector.salts[0]);

    expect(hasViolation(state)).toBe(true);
    expect(resolvedDraw(state, 0)).toBeNull();
  });

  test("rejects a tampered card reveal", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);

    const position = 3;
    const wrongCard = dealer.deck[(position + 1) % 52];
    state = await applyCardReveal(state, position, wrongCard, dealer.salts[position]);

    expect(hasViolation(state)).toBe(true);
  });

  test("card reveal before commitments are known is a violation, not a throw", async () => {
    const state = await applyCardReveal(
      createProtocolState(),
      0,
      { suit: "Hearts", rank: 14 },
      new Uint8Array(16),
    );
    expect(hasViolation(state)).toBe(true);
  });

  test("commitPlacement binds card, hand index and salt", async () => {
    const card = { suit: "Hearts" as const, rank: 14 as const };
    const salt = generateSalt();
    const commitment = await commitPlacement(card, 2, salt);
    expect(await verify(`${cardId(card)}:2`, salt, commitment)).toBe(true);
    expect(await commitPlacement(card, 3, salt)).not.toBe(commitment);
    expect(await commitPlacement({ suit: "Spades", rank: 14 }, 2, salt)).not.toBe(commitment);
    expect(await commitPlacement(card, 2, generateSalt())).not.toBe(commitment);
  });

  describe("placement commit / batched reveal", () => {
    const POS = { 0: 7, 1: 12 } as const; // hand -> deck position
    const DRAW = { 0: 44, 1: 50 } as const; // hand -> draw index

    async function setup() {
      const dealer = await generateDealerCommitments(generateSeed());
      let state = setCommitments(createProtocolState(), "dealer", dealer.commitments);
      state = { ...state, positions: { [DRAW[0]]: POS[0], [DRAW[1]]: POS[1] } };
      state = recordHiddenDraw(state, 0, DRAW[0]);
      state = recordHiddenDraw(state, 1, DRAW[1]);
      const entry = async (hand: 0 | 1, salt = generateSalt()) => {
        const card = dealer.deck[POS[hand]];
        state = applyPlacementCommit(state, {
          by: "p1",
          dealer: "p1",
          handIndex: hand,
          commitment: await commitPlacement(card, hand, salt),
        });
        return {
          handIndex: hand,
          cardId: cardId(card),
          saltHex: saltToHex(salt),
          drawIndex: DRAW[hand],
          deckSaltHex: saltToHex(dealer.salts[POS[hand]]),
        };
      };
      return { dealer, entry, get: () => state, set: (s: typeof state) => (state = s) };
    }

    test("verifies a batch against commits and deck commitments and records it", async () => {
      const t = await setup();
      const entries = [await t.entry(0), await t.entry(1)];
      const s = await applyPlacementReveal(t.get(), "p1", entries);
      expect(hasViolation(s)).toBe(false);
      expect(s.revealBatches.p1).toEqual({ 0: t.dealer.deck[POS[0]], 1: t.dealer.deck[POS[1]] });
    });

    test("the LATEST commit per hand wins", async () => {
      const t = await setup();
      const oldEntry = await t.entry(0);
      const newEntry = await t.entry(0); // second commit for the same hand
      expect(hasViolation(await applyPlacementReveal(t.get(), "p1", [newEntry]))).toBe(false);
      const stale = await applyPlacementReveal(t.get(), "p1", [oldEntry]);
      expect(hasViolation(stale)).toBe(true);
      expect(stale.revealBatches.p1).toBeUndefined();
    });

    test("tampering is a violation and records nothing", async () => {
      const t = await setup();
      const good = await t.entry(0);
      const other = t.dealer.deck[(POS[0] + 1) % 52];
      const cases: Record<string, Omit<typeof good, "handIndex"> & { handIndex: number }> = {
        "wrong deck salt": { ...good, deckSaltHex: saltToHex(generateSalt()) },
        "wrong drawIndex for the hand": { ...good, drawIndex: DRAW[1] },
        "card not matching the commitment": { ...good, cardId: cardId(other) },
        "hand never hidden": { ...good, handIndex: 3 },
        "malformed card id": { ...good, cardId: "garbage" },
      };
      for (const [name, entry] of Object.entries(cases)) {
        const s = await applyPlacementReveal(t.get(), "p1", [entry]);
        expect(hasViolation(s), name).toBe(true);
        expect(s.revealBatches.p1, name).toBeUndefined();
      }
    });

    test("a card matching its own placement commit but not the deck commitment is a violation", async () => {
      const t = await setup();
      const fake = t.dealer.deck[(POS[0] + 1) % 52];
      const salt = generateSalt();
      const state = applyPlacementCommit(t.get(), {
        by: "p1",
        dealer: "p1",
        handIndex: 0,
        commitment: await commitPlacement(fake, 0, salt),
      });
      const s = await applyPlacementReveal(state, "p1", [
        {
          handIndex: 0,
          cardId: cardId(fake),
          saltHex: saltToHex(salt),
          drawIndex: DRAW[0],
          deckSaltHex: saltToHex(t.dealer.salts[POS[0]]),
        },
      ]);
      expect(hasViolation(s)).toBe(true);
      expect(s.violations[0]).toMatch(/deck commitment/);
    });

    test("a commit from a non-dealer or for a bad hand is a violation and never overwrites", async () => {
      const base = applyPlacementCommit(createProtocolState(), { by: "p1", dealer: "p1", handIndex: 0, commitment: "real" });
      for (const msg of [
        { by: "p2" as const, dealer: "p1" as const, handIndex: 0, commitment: "evil" },
        { by: "p1" as const, dealer: "p1" as const, handIndex: 9, commitment: "x" },
        { by: "p1" as const, dealer: "p1" as const, handIndex: 0, commitment: 5 as unknown as string },
      ]) {
        const s = applyPlacementCommit(base, msg);
        expect(hasViolation(s)).toBe(true);
        expect(s.placementCommits[0]).toBe("real");
      }
    });

    test("an empty batch verifies; a duplicate batch is a violation keeping the first", async () => {
      const s = await applyPlacementReveal(createProtocolState(), "p2", []);
      expect(hasViolation(s)).toBe(false);
      expect(s.revealBatches.p2).toEqual({});
      const once = receiveRevealBatch(createProtocolState(), "p1", []);
      expect(hasViolation(once)).toBe(false);
      const twice = receiveRevealBatch(once, "p1", [{ handIndex: 0, cardId: "x", saltHex: "", drawIndex: 0, deckSaltHex: "" }]);
      expect(hasViolation(twice)).toBe(true);
      expect(twice.receivedBatches.p1).toEqual([]);
    });
  });
});
