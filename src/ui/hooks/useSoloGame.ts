import { useEffect, useRef, useState } from "react";
import { CARDS_PER_HAND } from "../../engine/constants";
import { makeDeck, otherPlayer } from "../../engine/deck";
import { getLegalHands, isFaceDownPlacement } from "../../engine/placement";
import type { Card, GameEvent, GameState, PlayerId } from "../../engine/types";
import { playResultSting } from "../sound/gameSounds";
import { sfx } from "../sound/useSfx";
import { useGameEngine } from "./useGameEngine";
import { useRevealPacer } from "./useRevealPacer";
import { useSoloAi } from "./useSoloAi";

/** In solo mode the human always holds this seat; the AI holds the other. */
export const HUMAN: PlayerId = "p1";
export const AI: PlayerId = otherPlayer(HUMAN);

export type SoloGameOptions = {
  /** Who places first. Alternates each rematch. Defaults to HUMAN. */
  firstTurn?: PlayerId;
  /**
   * Test-only determinism seams. Production passes neither: `deck` supplies a
   * pre-arranged 52-card deck (see `engine/testkit`), `rng` a custom shuffle
   * source.
   */
  deck?: Card[];
  rng?: () => number;
};

export type SoloGame = {
  state: GameState;
  getEvents: () => readonly GameEvent[];
  /** Hand indices the pending card may legally land on (empty off-turn). */
  legalHands: number[];
  /** The human may draw a card right now (their turn, nothing pending). */
  canDraw: boolean;
  isHumanTurn: boolean;
  /** True while the AI is mid-move — freeze the board. */
  aiThinking: boolean;

  /** Placing: draw this turn's card. */
  draw: () => void;
  /** Placing: commit the pending card to `handIndex` and end the turn. */
  placePending: (handIndex: number) => void;
  /** Replace: draw the candidate card. */
  replaceDraw: () => void;
  /** Replace: swap into `handIndex`, or pass with `null`. */
  replace: (handIndex: number | null) => void;
  /** Force-place the human's turn on timeout (auto hand + a strike). */
  timeout: () => void;
  playAgain: () => void;
};

function shuffle(cards: Card[], rng: () => number): Card[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Solo-mode composition: the shared {@link useGameEngine} wired to a local deck,
 * the {@link useSoloAi} turn driver, and the {@link useRevealPacer}, plus the
 * human's intents. The intents are plain functions — they are only ever called
 * from UI event handlers, so a stable identity would buy nothing.
 */
export function useSoloGame(opts: SoloGameOptions = {}): SoloGame {
  const rng = opts.rng ?? Math.random;
  const deck = useRef<Card[]>(opts.deck ?? shuffle(makeDeck(), rng));
  // Whoever places first this game. Only read at init and to pick the next
  // dealer; the REMATCH event does the actual state reset.
  const [firstTurn, setFirstTurn] = useState<PlayerId>(opts.firstTurn ?? HUMAN);

  const { state, dispatch, getEvents } = useGameEngine({
    mode: "solo",
    firstTurn,
  });

  useSoloAi({ state, ai: AI, deck, dispatch });
  useRevealPacer(state, dispatch);

  // Belt-and-suspenders: kill any looping sfx (the turn tick) on unmount.
  useEffect(() => () => sfx.stopAllLoops(), []);

  // Result sting, once.
  useEffect(() => {
    if (state.phase === "result" && state.result) {
      playResultSting(state.result, HUMAN);
    }
  }, [state.phase, state.result]);

  const isHumanTurn =
    state.turn === HUMAN &&
    (state.phase === "placing" || state.phase === "replace");

  // Which hands the dragged card may legally land on right now.
  // Placing: the fill-evenly rule. Replace: any hand whose face-down 5th
  // card can be swapped (all of them, once placing is done).
  const legalHands = !isHumanTurn
    ? []
    : state.phase === "replace"
      ? state.hands[HUMAN].flatMap((h, i) => {
          const fifth = h.cards[CARDS_PER_HAND - 1];
          return fifth && !fifth.faceUp ? [i] : [];
        })
      : getLegalHands(state.hands[HUMAN]);

  const canDraw = isHumanTurn && state.pendingCard === null;

  function draw() {
    if (state.phase !== "placing" || state.turn !== HUMAN || state.pendingCard) return;
    dispatch({ type: "DRAW", by: HUMAN, card: deck.current[state.drawCount] });
  }

  function placePending(handIndex: number) {
    if (state.phase !== "placing" || state.turn !== HUMAN || !state.pendingCard) return;
    dispatch({
      type: "END_TURN",
      by: HUMAN,
      handIndex,
      faceDown: isFaceDownPlacement(state.hands[HUMAN][handIndex]),
    });
  }

  function replaceDraw() {
    if (state.phase !== "replace" || state.turn !== HUMAN || state.pendingCard) return;
    dispatch({ type: "REPLACE_DRAW", by: HUMAN, card: deck.current[state.drawCount] });
  }

  function replace(handIndex: number | null) {
    if (state.phase !== "replace" || state.turn !== HUMAN || !state.pendingCard) return;
    dispatch({ type: "REPLACE", by: HUMAN, handIndex });
  }

  function timeout() {
    if (state.turn !== HUMAN || state.phase !== "placing") return;
    dispatch({ type: "TIMEOUT", by: HUMAN, card: deck.current[state.drawCount] });
  }

  function playAgain() {
    const nextDealer = otherPlayer(firstTurn);
    deck.current = shuffle(makeDeck(), rng);
    setFirstTurn(nextDealer);
    dispatch({ type: "REMATCH", dealer: nextDealer });
  }

  return {
    state,
    getEvents,
    legalHands,
    canDraw,
    isHumanTurn,
    aiThinking:
      state.turn === AI && (state.phase === "placing" || state.phase === "replace"),
    draw,
    placePending,
    replaceDraw,
    replace,
    timeout,
    playAgain,
  };
}
