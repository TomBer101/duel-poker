import { verify } from "./commitment";
import { cardId } from "../engine/deck";
import type { Card } from "../engine/types";

export type ProtocolRole = "dealer" | "selector";

export type ProtocolControllerState = {
  dealerCommitments: string[] | null;
  selectorCommitments: string[] | null;
  /** drawIndex -> deck position, once the selector's reveal verifies. */
  positions: Record<number, number>;
  /** deck position -> card, once the dealer's reveal verifies. */
  cards: Record<number, Card>;
  /** Human-readable verification failures. Non-empty halts the game. */
  violations: string[];
};

export function createProtocolState(): ProtocolControllerState {
  return {
    dealerCommitments: null,
    selectorCommitments: null,
    positions: {},
    cards: {},
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
