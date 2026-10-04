import { commit, deriveSalt, verify } from "./commitment";
import { generateDrawOrder, shuffleDeck } from "./shuffle";
import { cardId } from "../engine/deck";
import type { Card } from "../engine/types";

export type DealerCommitmentState = {
  /** The secret seed (in-memory only, never serialized): placement salts derive from it. */
  seed: Uint8Array;
  deck: Card[];
  commitments: string[];
  salts: Uint8Array[];
};

export type SelectorCommitmentState = {
  drawOrder: number[];
  commitments: string[];
  salts: Uint8Array[];
};

export type CardReveal = { card: Card; salt: Uint8Array };
export type DrawReveal = { position: number; salt: Uint8Array };

/**
 * Dealer shuffles the deck and commits to every card's position. Salts are
 * deterministic in the seed (tag "deck", u32be position) so a refreshed client
 * regenerates identical commitments.
 */
export async function generateDealerCommitments(
  seed: Uint8Array,
): Promise<DealerCommitmentState> {
  const deck = shuffleDeck(seed);
  const salts = await Promise.all(deck.map((_, i) => deriveSalt(seed, "deck", i)));
  const commitments = await Promise.all(
    deck.map((card, i) => commit(cardId(card), salts[i])),
  );
  return { seed, deck, commitments, salts };
}

/** Selector generates a draw order and commits to every draw index's position (tag "draw"). */
export async function generateSelectorCommitments(
  seed: Uint8Array,
): Promise<SelectorCommitmentState> {
  const drawOrder = generateDrawOrder(seed);
  const salts = await Promise.all(drawOrder.map((_, i) => deriveSalt(seed, "draw", i)));
  const commitments = await Promise.all(
    drawOrder.map((position, i) => commit(String(position), salts[i])),
  );
  return { drawOrder, commitments, salts };
}

/**
 * Salt for a dealer placement commitment. Layout: seed || 0x05 || "place" ||
 * u32be handIndex || u32be drawIndex. A swap uses a different drawIndex, so
 * it gets a fresh salt.
 */
export function derivePlacementSalt(
  seed: Uint8Array,
  handIndex: number,
  drawIndex: number,
): Promise<Uint8Array> {
  return deriveSalt(seed, "place", handIndex, drawIndex);
}

/** Selector reveals the deck position it committed to for a draw index. */
export function revealDraw(
  drawIndex: number,
  selectorState: SelectorCommitmentState,
): DrawReveal {
  return { position: selectorState.drawOrder[drawIndex], salt: selectorState.salts[drawIndex] };
}

/** Dealer reveals the card it committed to for a deck position. */
export function revealCard(position: number, dealerState: DealerCommitmentState): CardReveal {
  return { card: dealerState.deck[position], salt: dealerState.salts[position] };
}

export function verifyDraw(reveal: DrawReveal, commitment: string): Promise<boolean> {
  return verify(String(reveal.position), reveal.salt, commitment);
}

export function verifyCard(reveal: CardReveal, commitment: string): Promise<boolean> {
  return verify(cardId(reveal.card), reveal.salt, commitment);
}
