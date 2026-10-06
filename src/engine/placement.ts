import { CARDS_PER_HAND } from "./constants";
import type { Hand } from "./types";

/**
 * The "fill evenly" rule: you may only add a card to a hand that currently has
 * the fewest cards. Returns the indices of hands that can legally receive the
 * next card. Empty once every hand is full.
 */
export function getLegalHands(hands: Hand[]): number[] {
  const lengths = hands.map((h) => h.cards.length);
  const min = Math.min(...lengths);
  if (min >= CARDS_PER_HAND) return [];
  const legal: number[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (lengths[i] === min) legal.push(i);
  }
  return legal;
}

/**
 * Replace phase: every full hand's face-down 5th card may be swapped, so every
 * hand holding one is a legal target (the fill-evenly rule no longer applies).
 */
export function getReplaceableHands(hands: Hand[]): number[] {
  return hands.flatMap((h, i) => (h.cards[CARDS_PER_HAND - 1]?.faceUp === false ? [i] : []));
}

/**
 * Deterministic auto-placement target for a timeout: the lowest-index legal
 * hand. Throws if no hand can accept a card.
 */
export function getAutoPlaceIndex(hands: Hand[]): number {
  const legal = getLegalHands(hands);
  if (legal.length === 0) {
    throw new Error("getAutoPlaceIndex: no legal hand available");
  }
  return legal[0];
}

/**
 * The 5th card placed in any hand must be face-down. A placement is face-down
 * iff the target hand already holds 4 cards.
 */
export function isFaceDownPlacement(hand: Hand): boolean {
  return hand.cards.length === CARDS_PER_HAND - 1;
}
