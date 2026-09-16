import { describe, expect, test } from "vitest";
import { createPRNG, generateDrawOrder, shuffleDeck } from "./shuffle";
import { DECK_SIZE } from "../engine/constants";

const seedA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const seedB = new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

describe("createPRNG", () => {
  test("same seed produces the same sequence", () => {
    const rngA = createPRNG(seedA);
    const rngB = createPRNG(seedA);
    const seqA = Array.from({ length: 10 }, () => rngA());
    const seqB = Array.from({ length: 10 }, () => rngB());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds produce different sequences", () => {
    const rngA = createPRNG(seedA);
    const rngB = createPRNG(seedB);
    const seqA = Array.from({ length: 10 }, () => rngA());
    const seqB = Array.from({ length: 10 }, () => rngB());
    expect(seqA).not.toEqual(seqB);
  });

  test("produces values in [0, 1)", () => {
    const rng = createPRNG(seedA);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("shuffleDeck", () => {
  test("same seed produces the same shuffled deck", () => {
    const deckA = shuffleDeck(seedA);
    const deckB = shuffleDeck(seedA);
    expect(deckA).toEqual(deckB);
  });

  test("different seeds produce different orderings", () => {
    const deckA = shuffleDeck(seedA);
    const deckB = shuffleDeck(seedB);
    expect(deckA).not.toEqual(deckB);
  });

  test("contains all 52 cards exactly once", () => {
    const deck = shuffleDeck(seedA);
    expect(deck).toHaveLength(DECK_SIZE);
    const ids = new Set(deck.map((c) => `${c.suit}-${c.rank}`));
    expect(ids.size).toBe(DECK_SIZE);
  });
});

describe("generateDrawOrder", () => {
  test("same seed produces the same order", () => {
    const orderA = generateDrawOrder(seedA);
    const orderB = generateDrawOrder(seedA);
    expect(orderA).toEqual(orderB);
  });

  test("is a permutation of 0..51 with no duplicates", () => {
    const order = generateDrawOrder(seedA);
    expect(order).toHaveLength(DECK_SIZE);
    expect(new Set(order).size).toBe(DECK_SIZE);
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: DECK_SIZE }, (_, i) => i),
    );
  });
});
