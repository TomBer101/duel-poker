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
  // The salts of my own secret face-down placements (needed by the reveal
  // phase) — dealer only.
  pendingPlacementSalts: RefObject<Map<number, Uint8Array>>;
  // Dealer only: hand -> the draw index whose card currently sits face-down in
  // that hand (set when it's placed/swapped), so the reveal batch can name and
  // bind each card to the deck commitment at that draw's position.
  ownSlotDraw: RefObject<Map<number, number>>;
  // The draw index whose placement / replace / timeout is already in flight
  // (double-click and cross-path guards).
  placedForDraw: RefObject<number | null>;
  replacedForDraw: RefObject<number | null>;
  timedOutForDraw: RefObject<number | null>;
  timedOutOwnHiddenForDraw: RefObject<number | null>;
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
    refs: SharedRefs;
  };

/** What `useShuffle` needs: the ctx minus what it produces itself (and the shared refs). */
export type ShuffleInput = Omit<MultiplayerCtx, keyof ShuffleHandle | "refs">;
