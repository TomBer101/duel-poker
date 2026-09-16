import { makeDeck } from "../engine/deck";
import type { Card } from "../engine/types";

/** Derive four 32-bit xorshift128 state words from an arbitrary-length seed. */
function seedState(seed: Uint8Array): [number, number, number, number] {
  const state: [number, number, number, number] = [
    0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x85ebca6b,
  ];
  for (let i = 0; i < seed.length; i++) {
    state[i % 4] = (state[i % 4] ^ (seed[i] + i * 0x01000193)) >>> 0;
  }
  return state;
}

/**
 * Deterministic xorshift128 PRNG. Returns a closure yielding floats in [0, 1)
 * on each call, given the same seed always producing the same sequence.
 */
export function createPRNG(seed: Uint8Array): () => number {
  let [x, y, z, w] = seedState(seed);
  return () => {
    const t = (x ^ (x << 11)) >>> 0;
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w / 0x100000000;
  };
}

/** Fisher-Yates shuffle of a fresh deck, driven by a seeded PRNG. */
export function shuffleDeck(seed: Uint8Array): Card[] {
  const deck = makeDeck();
  const rng = createPRNG(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** A permutation of [0..51], driven by a seeded PRNG. */
export function generateDrawOrder(seed: Uint8Array): number[] {
  const order = Array.from({ length: 52 }, (_, i) => i);
  const rng = createPRNG(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
