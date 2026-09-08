import { useCallback, useEffect, useReducer, useRef } from "react";
import { createAiOpponent } from "../../ai";
import { HANDS_PER_PLAYER } from "../../engine/constants";
import { makeDeck, otherPlayer } from "../../engine/deck";
import { getLegalHands, isFaceDownPlacement } from "../../engine/placement";
import { createInitialState, gameReducer } from "../../engine/reducer";
import type { Card, GameEvent, GameState, PlayerId } from "../../engine/types";
import { sfx } from "../sound/useSfx";

/** In solo mode the human always holds this seat; the AI holds the other. */
export const HUMAN: PlayerId = "p1";
export const AI: PlayerId = otherPlayer(HUMAN);

/** Beats (ms) that make the AI feel like it is thinking rather than snapping. */
const AI_DRAW_DELAY = 650;
const AI_PLACE_DELAY = 750;
/** Pause between each hand during the auto-advancing reveal. */
export const REVEAL_STEP_MS = 3000;

export type UseGameOptions = {
  /** Who takes the first placing turn. Alternates on rematch. Defaults to HUMAN. */
  firstTurn?: PlayerId;
  /**
   * Test-only determinism seam: supply a pre-arranged 52-card deck (as in
   * `engine/testkit`) or a custom RNG. Production passes neither.
   */
  deck?: Card[];
  rng?: () => number;
};

function shuffle(cards: Card[], rng: () => number): Card[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type UseGame = {
  state: GameState;
  /** Legal hand indices for the human's next placement (empty when not their turn). */
  legalHands: number[];
  isHumanTurn: boolean;
  /** True while the AI is mid-move — freeze the board. */
  aiThinking: boolean;

  /** Placing phase: draw this turn's card. */
  draw: () => void;
  /** Placing phase: commit the pending card to `handIndex` and end the turn. */
  placePending: (handIndex: number) => void;
  /** Replace phase: draw the candidate card. */
  replaceDraw: () => void;
  /** Replace phase: swap into `handIndex`, or pass with `null`. */
  replace: (handIndex: number | null) => void;
  /** Force-place the human's turn on timeout (auto hand + a strike). */
  timeout: () => void;

  playAgain: () => void;
};

export function useGame(opts: UseGameOptions = {}): UseGame {
  const rng = opts.rng ?? Math.random;

  // The deck never leaves the client in solo mode. `state.drawCount` is the
  // cursor into it; every card is handed to the reducer on its event.
  const deckRef = useRef<Card[]>(opts.deck ?? shuffle(makeDeck(), rng));
  const firstTurnRef = useRef<PlayerId>(opts.firstTurn ?? HUMAN);

  const [state, rawDispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState({ mode: "solo", firstTurn: opts.firstTurn ?? HUMAN }),
  );

  // Mirror of the latest committed state, for reading inside delayed callbacks.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => () => sfx.stopAllLoops(), []);

  /** Dispatch an engine event and fire the matching sound. */
  const dispatch = useCallback((event: GameEvent) => {
    switch (event.type) {
      case "DRAW":
      case "REPLACE_DRAW":
        sfx.play("card-draw");
        break;
      case "END_TURN":
      case "REPLACE":
        sfx.play("card-place");
        break;
      case "TIMEOUT":
        sfx.play("time-up");
        break;
    }
    rawDispatch(event);
  }, []);

  const nextCard = useCallback((): Card => {
    const card = deckRef.current[stateRef.current.drawCount];
    if (!card) throw new Error("useGame: deck exhausted");
    return card;
  }, []);

  // --- Human intents ------------------------------------------------------

  const draw = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "placing" || s.turn !== HUMAN || s.pendingCard) return;
    dispatch({ type: "DRAW", by: HUMAN, card: nextCard() });
  }, [dispatch, nextCard]);

  const placePending = useCallback(
    (handIndex: number) => {
      const s = stateRef.current;
      if (s.phase !== "placing" || s.turn !== HUMAN || !s.pendingCard) return;
      const faceDown = isFaceDownPlacement(s.hands[HUMAN][handIndex]);
      dispatch({ type: "END_TURN", by: HUMAN, handIndex, faceDown });
    },
    [dispatch],
  );

  const replaceDraw = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "replace" || s.turn !== HUMAN || s.pendingCard) return;
    dispatch({ type: "REPLACE_DRAW", by: HUMAN, card: nextCard() });
  }, [dispatch, nextCard]);

  const replace = useCallback(
    (handIndex: number | null) => {
      const s = stateRef.current;
      if (s.phase !== "replace" || s.turn !== HUMAN || !s.pendingCard) return;
      dispatch({ type: "REPLACE", by: HUMAN, handIndex });
    },
    [dispatch],
  );

  const timeout = useCallback(() => {
    const s = stateRef.current;
    if (s.turn !== HUMAN || s.phase !== "placing") return;
    dispatch({ type: "TIMEOUT", by: HUMAN, card: nextCard() });
  }, [dispatch, nextCard]);

  const playAgain = useCallback(() => {
    deckRef.current = shuffle(makeDeck(), rng);
    firstTurnRef.current = otherPlayer(firstTurnRef.current);
    dispatch({ type: "REMATCH", dealer: firstTurnRef.current });
  }, [dispatch, rng]);

  // --- AI driver -------------------------------------------------------
  // Two effects, each reacting to *committed* state so a step never reads a
  // reducer update that React has not applied yet. Human-ish pauses between.

  // 1. AI's turn, nothing drawn yet -> draw after a beat.
  useEffect(() => {
    if (state.turn !== AI || state.pendingCard) return;
    if (state.phase !== "placing" && state.phase !== "replace") return;
    const type = state.phase === "placing" ? "DRAW" : "REPLACE_DRAW";
    const id = setTimeout(() => {
      const card = deckRef.current[stateRef.current.drawCount];
      dispatch({ type, by: AI, card });
    }, AI_DRAW_DELAY);
    return () => clearTimeout(id);
  }, [state.turn, state.phase, state.pendingCard, state.drawCount, dispatch]);

  // 2. AI's turn, card in hand -> place / replace after a beat.
  useEffect(() => {
    if (state.turn !== AI || !state.pendingCard) return;
    if (state.phase !== "placing" && state.phase !== "replace") return;
    const card = state.pendingCard;
    const id = setTimeout(() => {
      const s = stateRef.current;
      const ai = createAiOpponent(AI);
      if (s.phase === "placing") {
        const handIndex = ai.chooseHandIndex(s, card);
        dispatch({
          type: "END_TURN",
          by: AI,
          handIndex,
          faceDown: isFaceDownPlacement(s.hands[AI][handIndex]),
        });
      } else {
        const { handIndex } = ai.chooseReplacement(s, card);
        dispatch({ type: "REPLACE", by: AI, handIndex });
      }
    }, AI_PLACE_DELAY);
    return () => clearTimeout(id);
  }, [state.turn, state.phase, state.pendingCard, dispatch]);

  // --- Reveal driver ---------------------------------------------------
  // The reveal phase auto-advances one hand every REVEAL_STEP_MS.

  useEffect(() => {
    if (state.phase !== "reveal") return;
    if (state.revealIndex >= HANDS_PER_PLAYER) return;
    const id = setTimeout(() => {
      sfx.play("card-flip");
      rawDispatch({ type: "ADVANCE_REVEAL" });
    }, REVEAL_STEP_MS);
    return () => clearTimeout(id);
  }, [state.phase, state.revealIndex]);

  // Result-overlay sting, once.
  useEffect(() => {
    if (state.phase !== "result" || !state.result) return;
    const w = state.result.winner;
    sfx.play(w === "draw" ? "draw-game" : w === HUMAN ? "win" : "lose");
  }, [state.phase, state.result]);

  const isHumanTurn =
    state.turn === HUMAN &&
    (state.phase === "placing" || state.phase === "replace");

  return {
    state,
    legalHands: isHumanTurn ? getLegalHands(state.hands[HUMAN]) : [],
    isHumanTurn,
    aiThinking: state.turn === AI,
    draw,
    placePending,
    replaceDraw,
    replace,
    timeout,
    playAgain,
  };
}
