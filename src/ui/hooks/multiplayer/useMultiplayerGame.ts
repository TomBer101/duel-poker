import { useRef } from "react";
import type { Database } from "firebase/database";
import { getLegalHands } from "../../../engine/placement";
import type { PlayerId } from "../../../engine/types";
import { useGameEngine } from "../useGameEngine";
import type { SoloGame } from "../useSoloGame";
import type { MultiplayerCtx, SharedRefs } from "./context";
import { placePending, replace, timeout } from "./myMoves";
import { useOpeningDeal } from "./useOpeningDeal";
import { useOpponentEvents } from "./useOpponentEvents";
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
};

/**
 * Same handle shape as {@link SoloGame} so GameScreen can treat both hooks
 * alike; `aiThinking` is always false (there is no AI in multiplayer).
 */
export type MultiplayerGame = Omit<SoloGame, "aiThinking"> & {
  aiThinking: false;
  /** True once any commit-reveal verification failed (Task 15 renders the screen). */
  hasViolation: boolean;
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
 * REVEAL_FACE_DOWN. Several effects are deliberately dependency-less: the data
 * they wait on lives in refs, and `bumpTick` forces the re-render that makes
 * them re-check.
 */
export function useMultiplayerGame(opts: MultiplayerGameOptions): MultiplayerGame {
  const { db, roomId, you, gameNumber } = opts;
  const { state, dispatch, getEvents } = useGameEngine({ mode: "multiplayer", firstTurn: "p1" });
  const protocolHandle = useProtocol();
  const shuffle = useShuffle({ db, roomId, you, gameNumber, state, dispatch, ...protocolHandle });

  // Cross-module refs: created once here, shared through ctx (see SharedRefs).
  const refs: SharedRefs = {
    pendingPlacementSalts: useRef<Map<number, Uint8Array>>(new Map()),
    ownSlotDraw: useRef<Map<number, number>>(new Map()),
    placedForDraw: useRef<number | null>(null),
    replacedForDraw: useRef<number | null>(null),
    timedOutForDraw: useRef<number | null>(null),
    timedOutOwnHiddenForDraw: useRef<number | null>(null),
  };
  const ctx: MultiplayerCtx = { db, roomId, you, gameNumber, state, dispatch, ...protocolHandle, ...shuffle, refs };

  useOpeningDeal(ctx);
  useOpponentEvents(ctx);
  useTurnDraws(ctx);
  useRevealPhase(ctx);

  const isHumanTurn = state.turn === you && (state.phase === "placing" || state.phase === "replace");
  // Replace-phase legality arrives with the replace flow (a later task).
  const legalHands =
    isHumanTurn && state.phase === "placing" ? getLegalHands(state.hands[you]) : [];

  return {
    state,
    getEvents,
    you,
    legalHands,
    // Always false: a multiplayer draw is not a button press. The card only
    // becomes known once the verified reveal chain resolves it, which happens
    // automatically at the start of the turn; a "Draw" button would have
    // nothing to publish.
    canDraw: false,
    isHumanTurn,
    aiThinking: false,
    // Inert: present only so this satisfies the SoloGame shape.
    draw: () => {},
    replaceDraw: () => {},
    placePending: (handIndex) => placePending(ctx, legalHands, handIndex),
    replace: (handIndex) => replace(ctx, handIndex),
    hasViolation: protocolHandle.violated,
    timeout: () => timeout(ctx),
    // Stub for a later task (rematch).
    playAgain: () => {},
  };
}
