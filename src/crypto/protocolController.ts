import { commit, hexToSalt, verify } from "./commitment";
import { HANDS_PER_PLAYER } from "../engine/constants";
import { cardFromId, cardId } from "../engine/deck";
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
  /** Selector-side: hand -> draw index of its latest hidden placement/swap. */
  hiddenDraws: Record<number, number>;
  /** Raw opponent batches awaiting verification (verified once the phase is reveal). */
  receivedBatches: Partial<Record<PlayerId, PlacementRevealWire[]>>;
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
    hiddenDraws: {},
    receivedBatches: {},
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

/**
 * Records a placement commitment; a later commit for the same hand replaces the
 * earlier one. Only the dealer may commit, for a valid hand: anything else is a
 * violation and never overwrites an existing commit.
 */
export function applyPlacementCommit(
  state: ProtocolControllerState,
  msg: { by: PlayerId; dealer: PlayerId; handIndex: number; commitment: string },
): ProtocolControllerState {
  const { by, dealer, handIndex, commitment } = msg;
  if (by !== dealer) return withViolation(state, `placement commit from non-dealer ${String(by)}`);
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= HANDS_PER_PLAYER) {
    return withViolation(state, `placement commit for invalid hand ${String(handIndex)}`);
  }
  if (typeof commitment !== "string" || commitment.length === 0) {
    return withViolation(state, `placement commit for hand ${handIndex} is not a string`);
  }
  return { ...state, placementCommits: { ...state.placementCommits, [handIndex]: commitment } };
}

/** Selector-side: the draw index of the card it just saw placed/swapped hidden (latest per hand wins). */
export function recordHiddenDraw(
  state: ProtocolControllerState,
  handIndex: number,
  drawIndex: number,
): ProtocolControllerState {
  return { ...state, hiddenDraws: { ...state.hiddenDraws, [handIndex]: drawIndex } };
}

/** Stores a player's raw batch for later verification; a second batch is a violation (first kept). */
export function receiveRevealBatch(
  state: ProtocolControllerState,
  by: PlayerId,
  entries: PlacementRevealWire[],
): ProtocolControllerState {
  if (state.receivedBatches[by] || state.revealBatches[by]) {
    return withViolation(state, `duplicate placement reveal batch from ${by}`);
  }
  return { ...state, receivedBatches: { ...state.receivedBatches, [by]: entries } };
}

/** Wire shape of one batch entry (`net/sync.ts` mirrors it). */
export type PlacementRevealWire = {
  handIndex: number;
  cardId: string;
  saltHex: string;
  /** Draw index that produced the card (face-down placing draw, or replace draw). */
  drawIndex: number;
  /** The dealer's per-position deck salt for the card at that draw's position. */
  deckSaltHex: string;
};

/**
 * Verifies one player's batched reveal. Per entry: (1) the hand was really
 * hidden and at this drawIndex (selector's own record), (2) the card matches
 * the LATEST placement commit for the hand, (3) the card matches the dealer's
 * DECK commitment at the position the selector itself revealed for drawIndex.
 * All-or-nothing: any failure records a violation and the batch is not
 * recorded. An empty batch is valid.
 */
export async function applyPlacementReveal(
  state: ProtocolControllerState,
  by: PlayerId,
  entries: PlacementRevealWire[],
): Promise<ProtocolControllerState> {
  const verified: Record<number, Card> = {};
  try {
    for (const e of entries) {
      const { handIndex, drawIndex } = e;
      if (handIndex in verified) {
        return withViolation(state, `placement reveal lists hand ${handIndex} twice`);
      }
      if (state.hiddenDraws[handIndex] === undefined) {
        return withViolation(state, `placement reveal for hand ${handIndex} which was never hidden`);
      }
      if (state.hiddenDraws[handIndex] !== drawIndex) {
        return withViolation(state, `placement reveal for hand ${handIndex} names draw ${drawIndex}, expected ${state.hiddenDraws[handIndex]}`);
      }
      const card = cardFromId(e.cardId);
      const expected = state.placementCommits[handIndex];
      if (!expected) {
        return withViolation(state, `placement reveal for hand ${handIndex} has no commitment`);
      }
      if ((await commitPlacement(card, handIndex, hexToSalt(e.saltHex))) !== expected) {
        return withViolation(state, `placement reveal failed verification for hand ${handIndex}`);
      }
      const position = state.positions[drawIndex];
      const deckCommitment = position === undefined ? undefined : state.dealerCommitments?.[position];
      if (!deckCommitment) {
        return withViolation(state, `no deck commitment for draw ${drawIndex} (hand ${handIndex})`);
      }
      if (!(await verify(cardId(card), hexToSalt(e.deckSaltHex), deckCommitment))) {
        return withViolation(state, `placement reveal for hand ${handIndex} does not match the deck commitment`);
      }
      verified[handIndex] = card;
    }
  } catch (err) {
    return withViolation(state, `malformed placement reveal: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ...state, revealBatches: { ...state.revealBatches, [by]: verified } };
}
