import type { RefObject } from "react";
import type { Database } from "firebase/database";
import type { GameEvent, GameState, PlayerId } from "../../../engine/types";
import type { DealerCommitmentState, SelectorCommitmentState } from "../../../crypto/protocol";
import type { ProtocolControllerState } from "../../../crypto/protocolController";

export type Role = "dealer" | "selector";

/** The protocol handle owned by `useProtocol` (see there for the queue semantics). */
export type ProtocolHandle = {
  protocol: RefObject<ProtocolControllerState>;
  protocolTick: number;
  violated: boolean;
  bumpTick: () => void;
  updateProtocol: (
    what: string,
    step: (current: ProtocolControllerState) => ProtocolControllerState | Promise<ProtocolControllerState>,
  ) => void;
  recordViolation: (message: string) => void;
  warnOnce: (key: string, message: string) => void;
};

/** Owned by `useShuffle`: who deals, and my half of the shuffle. */
export type ShuffleHandle = {
  dealer: PlayerId | null;
  role: Role | null;
  dealerState: RefObject<DealerCommitmentState | null>;
  selectorState: RefObject<SelectorCommitmentState | null>;
};

/**
 * Refs read/written by more than one module. Created ONCE by the root hook and
 * shared through ctx; never duplicated.
 */
export type SharedRefs = {
  // Dealer only: hand -> the draw index whose card currently sits face-down in
  // that hand (set when it's placed/swapped, or rebuilt from the log on
  // catch-up), so the reveal batch can name and bind each card to the deck
  // commitment at that draw's position and re-derive its placement salt.
  ownSlotDraw: RefObject<Map<number, number>>;
  // The draw index whose placement / replace / timeout is already in flight
  // (double-click and cross-path guards).
  placedForDraw: RefObject<number | null>;
  replacedForDraw: RefObject<number | null>;
  timedOutForDraw: RefObject<number | null>;
  timedOutOwnHiddenForDraw: RefObject<number | null>;
  // My FORFEIT claim is in flight or applied (double-click guard).
  claimedWin: RefObject<boolean>;
  // My rematch vote is published (or in flight) for this game: once per mount.
  rematchVoted: RefObject<boolean>;
  // My placement reveal batch is published (or in flight): set by the reveal
  // phase, and prefilled by useShuffle from the reveal log on mount so a
  // refreshed client never publishes a second batch (a violation for the
  // opponent).
  batchPublished: RefObject<boolean>;
  // Push keys of events already applied (or being published by me): the
  // intake applies every other event in the log exactly once.
  seenKeys: RefObject<Set<string>>;
  // `seq` of the last event applied (or consumed) locally, 0 before any: the
  // intake applies `lastSeq + 1` next, and my own moves publish at it.
  lastSeq: RefObject<number>;
};

/** Everything a sub-hook needs. Rebuilt by the root every render (latest `state`). */
export type MultiplayerCtx = ProtocolHandle &
  ShuffleHandle & {
    db: Database;
    roomId: string;
    you: PlayerId;
    gameNumber: number;
    state: GameState;
    dispatch: (event: GameEvent) => void;
    /** See `GameEngine.hasPendingDispatch`: effects deciding from `state` skip while true. */
    hasPendingDispatch: () => boolean;
    refs: SharedRefs;
  };

/** What `useShuffle` needs: the ctx minus what it produces itself. */
export type ShuffleInput = Omit<MultiplayerCtx, keyof ShuffleHandle>;
