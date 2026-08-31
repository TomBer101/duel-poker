import { HANDS_PER_PLAYER, CARDS_PER_HAND } from "../engine/constants";
import { compareHands, evaluateHand } from "../engine/poker";
import { getLegalHands } from "../engine/placement";
import type { Card, GameState, Hand, PlayerId } from "../engine/types";
import { projectHandStrength } from "./evaluate";

/**
 * Pull the known plaintext cards out of a hand. In solo mode the AI owns its
 * hands and knows every card, including face-down ones; in multiplayer a
 * face-down `PlacedCard` may carry no `card`, and it is simply skipped.
 */
function knownCards(hand: Hand): Card[] {
  return hand.cards
    .map((pc) => pc.card)
    .filter((c): c is Card => c !== undefined);
}

/**
 * Placing phase: choose which hand to drop `card` on.
 *
 * Scores every legal hand with {@link projectHandStrength} and takes the best.
 * Ties resolve to the lowest hand index, keeping the choice deterministic (the
 * fill-evenly rule already guarantees every legal hand holds the same number of
 * cards, so "tie-break by fewer cards" is a no-op here).
 *
 * Throws if no hand can legally accept a card — callers should not reach this.
 */
export function chooseHandIndex(
  state: GameState,
  player: PlayerId,
  card: Card,
): number {
  const legal = getLegalHands(state.hands[player]);
  if (legal.length === 0) {
    throw new Error("chooseHandIndex: no legal hand available");
  }

  let bestIndex = legal[0];
  let bestScore = -Infinity;
  for (const i of legal) {
    const score = projectHandStrength(knownCards(state.hands[player][i]), card);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Replace phase: given the drawn `card`, decide whether swapping it in for a
 * face-down 5th card improves any hand, and if so which one.
 *
 * Returns `{ handIndex }` shaped for the engine's `REPLACE` event: a number to
 * swap that hand's face-down card, or `null` to keep all hands as they are. The
 * AI only swaps when the new hand strictly beats the current one, and picks the
 * swap with the largest category jump.
 */
export function chooseReplacement(
  state: GameState,
  player: PlayerId,
  card: Card,
): { handIndex: number | null } {
  let bestIndex: number | null = null;
  let bestGain = 0;

  for (let i = 0; i < HANDS_PER_PLAYER; i++) {
    const hand = state.hands[player][i];
    const slot = hand.cards[CARDS_PER_HAND - 1];
    if (!slot || slot.faceUp) continue; // only the face-down 5th card is swappable

    const current = knownCards(hand);
    if (current.length !== CARDS_PER_HAND) continue; // can't evaluate a partial hand

    const swapped = [...current.slice(0, CARDS_PER_HAND - 1), card];
    const currentRank = evaluateHand(current);
    const swappedRank = evaluateHand(swapped);
    if (compareHands(swappedRank, currentRank) <= 0) continue;

    const gain = swappedRank.category - currentRank.category + 0.001;
    if (gain > bestGain) {
      bestGain = gain;
      bestIndex = i;
    }
  }

  return { handIndex: bestIndex };
}

/**
 * Difficulty / configuration holder for an AI opponent.
 *
 * V1 has a single heuristic strategy and no tunable knobs, so this is a thin
 * factory that just binds the opponent to a seat. It exists so callers depend
 * on an injected object rather than importing the module functions directly,
 * and so difficulty levels can be added here later without touching call sites.
 */
export type AiOpponent = {
  readonly player: PlayerId;
  chooseHandIndex(state: GameState, card: Card): number;
  chooseReplacement(state: GameState, card: Card): { handIndex: number | null };
};

export function createAiOpponent(player: PlayerId): AiOpponent {
  return {
    player,
    chooseHandIndex: (state, card) => chooseHandIndex(state, player, card),
    chooseReplacement: (state, card) => chooseReplacement(state, player, card),
  };
}
