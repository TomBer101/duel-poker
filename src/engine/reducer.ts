import {
  CARDS_PER_HAND,
  HANDS_PER_PLAYER,
  MAX_STRIKES,
} from "./constants";
import { otherPlayer } from "./deck";
import { getAutoPlaceIndex, getLegalHands, isFaceDownPlacement } from "./placement";
import { scoreGame } from "./scoring";
import type {
  Card,
  GameEvent,
  GameMode,
  GameState,
  Hand,
  PlacedCard,
  PlayerId,
} from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[reducer] ${msg}`);
}

function emptyHands(): Hand[] {
  return Array.from({ length: HANDS_PER_PLAYER }, () => ({ cards: [] as PlacedCard[] }));
}

export type InitOptions = {
  mode: GameMode;
  /** Which player takes the first placing turn. Defaults to "p1". */
  firstTurn?: PlayerId;
};

export function createInitialState({ mode, firstTurn = "p1" }: InitOptions): GameState {
  return {
    mode,
    phase: "placing",
    turn: firstTurn,
    drawCount: 0,
    hands: { p1: emptyHands(), p2: emptyHands() },
    strikes: { p1: 0, p2: 0 },
    pendingCard: null,
    replaceDone: { p1: false, p2: false },
    revealIndex: 0,
    result: null,
    forfeitedBy: null,
  };
}

export function gameReducer(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "DRAW":
      return applyDraw(state, event.by, event.card);
    case "END_TURN":
      return applyEndTurn(state, event.by, event.handIndex, event.faceDown);
    case "TIMEOUT":
      return applyTimeout(state, event.by, event.card);
    case "REPLACE_DRAW":
      return applyReplaceDraw(state, event.by, event.card);
    case "REPLACE":
      return applyReplace(state, event.by, event.handIndex);
    case "ADVANCE_REVEAL":
      return applyAdvanceReveal(state);
    case "REMATCH":
      return createInitialState({ mode: state.mode, firstTurn: event.dealer });
  }
}

/** Replay a sequence of events from an initial state. */
export function replay(initial: GameState, events: GameEvent[]): GameState {
  return events.reduce(gameReducer, initial);
}

// ---------------------------------------------------------------------------

function applyDraw(state: GameState, by: PlayerId, card: Card): GameState {
  assert(state.phase === "placing", `cannot DRAW during phase "${state.phase}"`);
  assert(state.turn === by, `not ${by}'s turn`);
  assert(state.pendingCard === null, "a card is already pending");
  return { ...state, pendingCard: card, drawCount: state.drawCount + 1 };
}

function placeCard(hand: Hand, card: Card): Hand {
  const faceUp = !isFaceDownPlacement(hand);
  const placed: PlacedCard = faceUp
    ? { card, faceUp: true }
    : { card, faceUp: false };
  return { cards: [...hand.cards, placed] };
}

function placingComplete(hands: Record<PlayerId, Hand[]>): boolean {
  return (["p1", "p2"] as const).every((p) =>
    hands[p].every((h) => h.cards.length === CARDS_PER_HAND),
  );
}

function applyEndTurn(
  state: GameState,
  by: PlayerId,
  handIndex: number,
  faceDown: boolean,
): GameState {
  assert(state.phase === "placing", `cannot END_TURN during phase "${state.phase}"`);
  assert(state.turn === by, `not ${by}'s turn`);
  assert(state.pendingCard !== null, "no pending card to place");
  const legal = getLegalHands(state.hands[by]);
  assert(legal.includes(handIndex), `hand ${handIndex} is not a legal placement`);
  assert(
    isFaceDownPlacement(state.hands[by][handIndex]) === faceDown,
    `END_TURN.faceDown (${faceDown}) disagrees with the placement rule`,
  );

  const hands = { ...state.hands, [by]: [...state.hands[by]] };
  hands[by][handIndex] = placeCard(hands[by][handIndex], state.pendingCard);

  return advanceAfterPlacement({ ...state, hands, pendingCard: null }, by);
}

function applyTimeout(state: GameState, by: PlayerId, card: Card): GameState {
  assert(state.phase === "placing", `cannot TIMEOUT during phase "${state.phase}"`);
  assert(state.turn === by, `TIMEOUT.by must be the active player (${state.turn})`);

  let drawCount = state.drawCount;
  let pending = state.pendingCard;
  if (pending === null) {
    pending = card;
    drawCount += 1;
  }

  const handIndex = getAutoPlaceIndex(state.hands[by]);
  const hands = { ...state.hands, [by]: [...state.hands[by]] };
  hands[by][handIndex] = placeCard(hands[by][handIndex], pending);

  const strikes = { ...state.strikes, [by]: state.strikes[by] + 1 };

  if (strikes[by] >= MAX_STRIKES) {
    return {
      ...state,
      hands,
      drawCount,
      pendingCard: null,
      strikes,
      phase: "result",
      forfeitedBy: by,
      revealIndex: HANDS_PER_PLAYER,
      result: { matchups: [], wins: { p1: 0, p2: 0 }, winner: otherPlayer(by) },
    };
  }

  return advanceAfterPlacement(
    { ...state, hands, drawCount, pendingCard: null, strikes },
    by,
  );
}

function advanceAfterPlacement(state: GameState, by: PlayerId): GameState {
  if (placingComplete(state.hands)) {
    return {
      ...state,
      phase: "replace",
      turn: "p1",
      replaceDone: { p1: false, p2: false },
    };
  }
  return { ...state, turn: otherPlayer(by) };
}

function applyReplaceDraw(state: GameState, by: PlayerId, card: Card): GameState {
  assert(state.phase === "replace", `cannot REPLACE_DRAW during phase "${state.phase}"`);
  assert(state.turn === by, `not ${by}'s turn`);
  assert(!state.replaceDone[by], `${by} has already completed the replace phase`);
  assert(state.pendingCard === null, "a card is already pending");
  return { ...state, pendingCard: card, drawCount: state.drawCount + 1 };
}

function applyReplace(state: GameState, by: PlayerId, handIndex: number | null): GameState {
  assert(state.phase === "replace", `cannot REPLACE during phase "${state.phase}"`);
  assert(state.turn === by, `not ${by}'s turn`);
  assert(!state.replaceDone[by], `${by} has already completed the replace phase`);
  assert(state.pendingCard !== null, "must REPLACE_DRAW before REPLACE");

  const hands = { ...state.hands, [by]: [...state.hands[by]] };

  if (handIndex !== null) {
    assert(
      handIndex >= 0 && handIndex < HANDS_PER_PLAYER,
      `hand ${handIndex} out of range`,
    );
    const hand = hands[by][handIndex];
    assert(hand.cards.length === CARDS_PER_HAND, `hand ${handIndex} is not full`);
    const slot = hand.cards[CARDS_PER_HAND - 1];
    assert(!slot.faceUp, "the swappable card must be the face-down 5th card");
    const newCards = [...hand.cards];
    newCards[CARDS_PER_HAND - 1] = { card: state.pendingCard, faceUp: false };
    hands[by][handIndex] = { cards: newCards };
  }

  const replaceDone = { ...state.replaceDone, [by]: true };
  const next: GameState = { ...state, hands, pendingCard: null, replaceDone };

  if (replaceDone.p1 && replaceDone.p2) {
    return {
      ...next,
      phase: "reveal",
      revealIndex: 0,
      result: scoreGame(next.hands),
    };
  }
  return { ...next, turn: otherPlayer(by) };
}

function applyAdvanceReveal(state: GameState): GameState {
  assert(state.phase === "reveal", `cannot ADVANCE_REVEAL during phase "${state.phase}"`);
  const revealIndex = Math.min(state.revealIndex + 1, HANDS_PER_PLAYER);
  return {
    ...state,
    revealIndex,
    phase: revealIndex >= HANDS_PER_PLAYER ? "result" : "reveal",
  };
}
