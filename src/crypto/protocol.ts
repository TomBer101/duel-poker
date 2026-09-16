import { commit, generateSalt, verify } from "./commitment";
import { generateDrawOrder, shuffleDeck } from "./shuffle";
import { cardId } from "../engine/deck";
import type { Card } from "../engine/types";

export type DealerCommitmentState = {
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

/** Dealer shuffles the deck and commits to every card's position. */
export async function generateDealerCommitments(
  seed: Uint8Array,
): Promise<DealerCommitmentState> {
  const deck = shuffleDeck(seed);
  const salts = deck.map(() => generateSalt());
  const commitments = await Promise.all(
    deck.map((card, i) => commit(cardId(card), salts[i])),
  );
  return { deck, commitments, salts };
}

/** Selector generates a draw order and commits to every draw index's position. */
export async function generateSelectorCommitments(
  seed: Uint8Array,
): Promise<SelectorCommitmentState> {
  const drawOrder = generateDrawOrder(seed);
  const salts = drawOrder.map(() => generateSalt());
  const commitments = await Promise.all(
    drawOrder.map((position, i) => commit(String(position), salts[i])),
  );
  return { drawOrder, commitments, salts };
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
