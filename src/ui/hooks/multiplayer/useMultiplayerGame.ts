import { useRef } from "react";
import type { Database } from "../../../net/firebase";
import { getLegalHands, getReplaceableHands } from "../../../engine/placement";
import type { PlayerId } from "../../../engine/types";
import { useGameEngine } from "../useGameEngine";
import { useRevealPacer } from "../useRevealPacer";
import type { SoloGame } from "../useSoloGame";
import type { MultiplayerCtx, SharedRefs } from "./context";
import { claimWin, placePending, playAgain, replace, timeout } from "./myMoves";
import { useRematch } from "./useRematch";
import { useOpeningDeal } from "./useOpeningDeal";
import { useOpponentEvents } from "./useOpponentEvents";
import { usePresence } from "./usePresence";
import { useProtocol } from "./useProtocol";
import { useRevealPhase } from "./useRevealPhase";
import { useShuffle } from "./useShuffle";
import { useTurnDraws } from "./useTurnDraws";

export type MultiplayerGameOptions = {
  db: Database;
  roomId: string;
  you: PlayerId;
  /** Distinguishes seeds/log state across rematches in the same room. */
  gameNumber: number;
  /** Test-only seam: the reveal pacer's step (defaults to REVEAL_STEP_MS). */
  revealStepMs?: number;
};

/**
 * Same handle shape as {@link SoloGame} so GameScreen can treat both hooks
 * alike; `aiThinking` is always false (there is no AI in multiplayer).
 */
export type MultiplayerGame = Omit<SoloGame, "aiThinking"> & {
  aiThinking: false;
  /** True once any commit-reveal verification failed (Task 15 renders the screen). */
  hasViolation: boolean;
  /** First violation message while `hasViolation`, else null. */
  violationReason: string | null;
  /** Forfeit the (disconnected) opponent; multiplayer-only, so not on SoloGame. */
  claimWin: () => void;
  /** True once MY rematch vote is observed; multiplayer-only. */
  rematchRequested: boolean;
};

/**
 * Multiplayer-mode composition: the shared {@link useGameEngine} wired to the
 * commit-reveal shuffle protocol (`crypto/protocol.ts` + `protocolController.ts`)
 * over Firebase (`net/sync.ts`, `net/roomState.ts`), instead of solo's local
 * deck.
 *
 * Thin root: builds the per-render ctx and calls the sub-hooks in a FIXED
 * order. That order is load-bearing — effects run in definition order within
 * a commit, and the sub-hooks below reproduce the pre-split sequence: dealer
 * subscription, seed/commitments, commitments subscription, selector position
 * reveals (opening, per-turn), reveals subscription, DEAL assembly, events
 * subscription, intake, per-turn DRAW, batch publish, batch verify,
 * REVEAL_FACE_DOWN, then the local reveal pacer. Several effects are deliberately dependency-less: the data
 * they wait on lives in refs, and `bumpTick` forces the re-render that makes
 * them re-check.
 */
export function useMultiplayerGame(opts: MultiplayerGameOptions): MultiplayerGame {
  const { db, roomId, you, gameNumber } = opts;
  const { state, dispatch, getEvents, hasPendingDispatch } = useGameEngine({ mode: "multiplayer", firstTurn: "p1" });
  const protocolHandle = useProtocol();

  // Cross-module refs: created once here, shared through ctx (see SharedRefs).
  const refs: SharedRefs = {
    ownSlotDraw: useRef<Map<number, number>>(new Map()),
    placedForDraw: useRef<number | null>(null),
    replacedForDraw: useRef<number | null>(null),
    timedOutForDraw: useRef<number | null>(null),
    timedOutOwnHiddenForDraw: useRef<number | null>(null),
    claimedWin: useRef(false),
    rematchVoted: useRef(false),
    seenKeys: useRef<Set<string>>(new Set()),
    lastSeq: useRef(0),
    batchPublished: useRef(false),
    resumed: useRef(false),
  };
  const shuffle = useShuffle({ db, roomId, you, gameNumber, state, dispatch, hasPendingDispatch, ...protocolHandle, refs });
  const ctx: MultiplayerCtx = { db, roomId, you, gameNumber, state, dispatch, hasPendingDispatch, ...protocolHandle, ...shuffle, refs };

  useOpeningDeal(ctx);
  useOpponentEvents(ctx);
  const { canDraw, draw } = useTurnDraws(ctx);
  useRevealPhase(ctx);
  // Local-only and deterministic: each client paces its own reveal from the
  // same REVEAL_FACE_DOWN state; ADVANCE_REVEAL is never published. Held on
  // a violation, so a cheated game never reaches its result (or its score).
  useRevealPacer(state, dispatch, opts.revealStepMs, !protocolHandle.violated);
  const { rematchRequested } = useRematch(ctx);
  usePresence(db, roomId, you);

  const isHumanTurn = state.turn === you && (state.phase === "placing" || state.phase === "replace");
  const legalHands = !isHumanTurn
    ? []
    : state.phase === "replace"
      ? getReplaceableHands(state.hands[you])
      : getLegalHands(state.hands[you]);

  return {
    state,
    getEvents,
    you,
    legalHands,
    canDraw,
    isHumanTurn,
    aiThinking: false,
    draw,
    replaceDraw: draw,
    placePending: (handIndex) => placePending(ctx, legalHands, handIndex),
    replace: (handIndex) => replace(ctx, handIndex),
    hasViolation: protocolHandle.violated,
    violationReason: protocolHandle.violationReason,
    timeout: () => timeout(ctx),
    claimWin: () => claimWin(ctx),
    playAgain: () => playAgain(ctx),
    rematchRequested,
  };
}
