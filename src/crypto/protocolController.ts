import { commit, verify } from "./commitment";
import { cardId } from "../engine/deck";
import type { Card, PlayerId } from "../engine/types";

export type ProtocolRole = "dealer" | "selector";

export type ProtocolControllerState = {
  dealerCommitments: string[] | null;
  selectorCommitments: string[] | null;
  /** drawIndex -> deck position, once the selector's reveal verifies. */
  positions: Record<number, number>;
  /** deck position -> card, once the dealer's reveal verifies. */
  cards: Record<number, Card>;
  /** handIndex -> the dealer's LATEST placement commitment for that hand. */
  placementCommits: Record<number, string>;
  /** Per player: hand index -> card, once that player's reveal batch verified. */
  revealBatches: Partial<Record<PlayerId, Record<number, Card>>>;
  /** Human-readable verification failures. Non-empty halts the game. */
  violations: string[];
};

export function createProtocolState(): ProtocolControllerState {
  return {
    dealerCommitments: null,
    selectorCommitments: null,
    positions: {},
    cards: {},
    placementCommits: {},
    revealBatches: {},
    violations: [],
  };
}

export function setCommitments(
  state: ProtocolControllerState,
  role: ProtocolRole,
  commitments: string[],
): ProtocolControllerState {
  return role === "dealer"
    ? { ...state, dealerCommitments: commitments }
    : { ...state, selectorCommitments: commitments };
}

function withViolation(state: ProtocolControllerState, message: string): ProtocolControllerState {
  return { ...state, violations: [...state.violations, message] };
}

/** The selector reveals which deck position a draw index maps to. */
export async function applyPositionReveal(
  state: ProtocolControllerState,
  drawIndex: number,
  position: number,
  salt: Uint8Array,
): Promise<ProtocolControllerState> {
  const commitment = state.selectorCommitments?.[drawIndex];
  if (!commitment) {
    return withViolation(state, `no selector commitment for draw index ${drawIndex}`);
  }
  const ok = await verify(String(position), salt, commitment);
  if (!ok) {
    return withViolation(state, `position reveal failed verification for draw index ${drawIndex}`);
  }
  return { ...state, positions: { ...state.positions, [drawIndex]: position } };
}

/** The dealer reveals the card at a deck position. */
export async function applyCardReveal(
  state: ProtocolControllerState,
  position: number,
  card: Card,
  salt: Uint8Array,
): Promise<ProtocolControllerState> {
  const commitment = state.dealerCommitments?.[position];
  if (!commitment) {
    return withViolation(state, `no dealer commitment for position ${position}`);
  }
  const ok = await verify(cardId(card), salt, commitment);
  if (!ok) {
    return withViolation(state, `card reveal failed verification for position ${position}`);
  }
  return { ...state, cards: { ...state.cards, [position]: card } };
}

/** The card for `drawIndex`, once both its position and card reveals verify. */
export function resolvedDraw(state: ProtocolControllerState, drawIndex: number): Card | null {
  const position = state.positions[drawIndex];
  if (position === undefined) return null;
  return state.cards[position] ?? null;
}

export function hasViolation(state: ProtocolControllerState): boolean {
  return state.violations.length > 0;
}

/** Hash for a dealer's secret face-down placement: H(cardId:handIndex || salt). */
export function commitPlacement(card: Card, handIndex: number, salt: Uint8Array): Promise<string> {
  return commit(`${cardId(card)}:${handIndex}`, salt);
}

/** Records a placement commitment; a later commit for the same hand replaces the earlier one. */
export function applyPlacementCommit(
  state: ProtocolControllerState,
  handIndex: number,
  commitment: string,
): ProtocolControllerState {
  return { ...state, placementCommits: { ...state.placementCommits, [handIndex]: commitment } };
}

export type PlacementRevealCard = { handIndex: number; card: Card; salt: Uint8Array };

/**
 * Verifies one player's batched reveal against the LATEST commit for each hand.
 * All-or-nothing: any mismatch or missing commit records a violation and the
 * batch is not recorded. An empty batch is valid (nothing hidden from the peer).
 */
export async function applyPlacementReveal(
  state: ProtocolControllerState,
  by: PlayerId,
  cards: PlacementRevealCard[],
): Promise<ProtocolControllerState> {
  const verified: Record<number, Card> = {};
  for (const { handIndex, card, salt } of cards) {
    const expected = state.placementCommits[handIndex];
    if (!expected) {
      return withViolation(state, `placement reveal for hand ${handIndex} has no commitment`);
    }
    if ((await commitPlacement(card, handIndex, salt)) !== expected) {
      return withViolation(state, `placement reveal failed verification for hand ${handIndex}`);
    }
    verified[handIndex] = card;
  }
  return { ...state, revealBatches: { ...state.revealBatches, [by]: verified } };
}
