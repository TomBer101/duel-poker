import { useEffect, useRef, useState } from "react";
import type { Database } from "firebase/database";
import { HANDS_PER_PLAYER } from "../../engine/constants";
import { cardFromId, cardId } from "../../engine/deck";
import type { Card, GameEvent, GameState, PlayerId } from "../../engine/types";
import { generateSeed, hexToSalt, saltToHex } from "../../crypto/commitment";
import {
  generateDealerCommitments,
  generateSelectorCommitments,
  revealCard,
  revealDraw,
  type DealerCommitmentState,
  type SelectorCommitmentState,
} from "../../crypto/protocol";
import {
  applyCardReveal,
  applyPositionReveal,
  createProtocolState,
  resolvedDraw,
  setCommitments,
  type ProtocolControllerState,
} from "../../crypto/protocolController";
import { loadSeed, saveSeed } from "../../crypto/seedStorage";
import {
  publishCommitments,
  publishReveal,
  subscribeToCommitments,
  subscribeToReveals,
  type ProtocolReveal,
} from "../../net/sync";
import { publishTurnStarted, subscribeToDealer } from "../../net/roomState";
import { useGameEngine } from "./useGameEngine";

export type MultiplayerGameOptions = {
  db: Database;
  roomId: string;
  you: PlayerId;
  /** Distinguishes seeds/log state across rematches in the same room. */
  gameNumber: number;
};

export type MultiplayerGame = {
  state: GameState;
  getEvents: () => readonly GameEvent[];
};

/** Deal draw index -> which player/hand it fills. Alternates for fill-evenly. */
const DEAL_SLOTS: { player: PlayerId; hand: number }[] = Array.from(
  { length: HANDS_PER_PLAYER * 2 },
  (_, i) => ({ player: (i % 2 === 0 ? "p1" : "p2") as PlayerId, hand: Math.floor(i / 2) }),
);

/**
 * Multiplayer-mode composition: the shared {@link useGameEngine} wired to the
 * commit-reveal shuffle protocol (`crypto/protocol.ts` + `protocolController.ts`)
 * over Firebase (`net/sync.ts`, `net/roomState.ts`), instead of solo's local
 * deck. This task only reaches the opening deal (10 cards, verified via
 * commit-reveal, dispatched as one DEAL event) — per-turn drawing is Task 6.
 */
export function useMultiplayerGame(opts: MultiplayerGameOptions): MultiplayerGame {
  const { db, roomId, you, gameNumber } = opts;
  const [dealer, setDealer] = useState<PlayerId | null>(null);
  const { state, dispatch, getEvents } = useGameEngine({ mode: "multiplayer", firstTurn: "p1" });

  const role = dealer ? (dealer === you ? "dealer" : "selector") : null;
  const dealerState = useRef<DealerCommitmentState | null>(null);
  const selectorState = useRef<SelectorCommitmentState | null>(null);
  const protocol = useRef<ProtocolControllerState>(createProtocolState());
  const dealBuffer = useRef<Map<number, Card>>(new Map());
  const dealt = useRef(false);
  const publishedPosition = useRef<Set<number>>(new Set());
  const publishedCard = useRef<Set<number>>(new Set());
  // Every protocol mutation (commitments AND reveals) goes through this one
  // promise chain. `applyPositionReveal`/`applyCardReveal` are async (they hash
  // via crypto.subtle.digest), so awaiting them concurrently and writing back
  // from a pre-await snapshot is a read-modify-write race — the last to
  // resolve would clobber the others. Each queued step instead reads
  // `protocol.current` only when it runs, so it always builds on the previous
  // step's result. A rejection is recorded as a violation and never breaks
  // the chain, so one bad message can't silently skip every later one.
  const protocolQueue = useRef<Promise<void>>(Promise.resolve());

  // `protocol` is a ref so its updates don't go through the reducer, but a
  // plain ref mutation alone never schedules a re-render — so effects that
  // depend on its contents (the selector's position reveals, the deal
  // assembly effect below) would never re-run once new data lands. This tick
  // forces a render after every mutation (and after the local dealer/selector
  // state refs are set) so those effects re-check.
  const [protocolTick, setProtocolTick] = useState(0);
  function bumpTick(): void {
    setProtocolTick((t) => t + 1);
  }
  function updateProtocol(
    what: string,
    step: (current: ProtocolControllerState) => ProtocolControllerState | Promise<ProtocolControllerState>,
  ): void {
    protocolQueue.current = protocolQueue.current
      .then(async () => {
        protocol.current = await step(protocol.current);
      })
      .catch((err: unknown) => {
        const message = `${what} failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[useMultiplayerGame] ${message}`);
        protocol.current = {
          ...protocol.current,
          violations: [...protocol.current.violations, message],
        };
      })
      .then(bumpTick);
  }

  // Who's dealer this game — read once at mount (set by the room creator /
  // rematch flow before either client mounts this hook).
  useEffect(() => subscribeToDealer(db, roomId, setDealer), [db, roomId]);

  // Generate my half of the shuffle and publish my 52 commitments.
  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    (async () => {
      let seed = loadSeed(roomId, gameNumber, you);
      if (!seed) {
        seed = generateSeed();
        saveSeed(roomId, gameNumber, you, seed);
      }
      if (role === "dealer") {
        const s = await generateDealerCommitments(seed);
        if (cancelled) return;
        dealerState.current = s;
        bumpTick();
        await publishCommitments(db, roomId, "dealer", s.commitments);
      } else {
        const s = await generateSelectorCommitments(seed);
        if (cancelled) return;
        selectorState.current = s;
        bumpTick();
        await publishCommitments(db, roomId, "selector", s.commitments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, roomId, gameNumber, you, role]);

  // Learn the opponent's (and echo of my own) commitments.
  useEffect(() => {
    if (!role) return;
    const offDealer = subscribeToCommitments(db, roomId, "dealer", (commitments) => {
      updateProtocol("dealer commitments", (cur) => setCommitments(cur, "dealer", commitments));
    });
    const offSelector = subscribeToCommitments(db, roomId, "selector", (commitments) => {
      updateProtocol("selector commitments", (cur) => setCommitments(cur, "selector", commitments));
    });
    return () => {
      offDealer();
      offSelector();
    };
  }, [db, roomId, role]);

  // The selector reveals the position for every opening-deal draw index
  // (0..9) as soon as both commitment sets are known. These 10 don't depend
  // on turn order — the selector already committed to all 52 up front — so
  // they're revealed eagerly together rather than one at a time gated by
  // `state.drawCount`: during the opening deal `drawCount` stays at 0 until
  // the DEAL event fires, which itself waits on all 10 of these reveals, so
  // gating on `state.drawCount` here would deadlock. Post-deal, per-turn
  // draws (Task 6) are a separate concern from this effect.
  useEffect(() => {
    if (role !== "selector" || !selectorState.current) return;
    if (!protocol.current.dealerCommitments || !protocol.current.selectorCommitments) return;
    for (let drawIndex = 0; drawIndex < DEAL_SLOTS.length; drawIndex++) {
      if (publishedPosition.current.has(drawIndex)) continue;
      publishedPosition.current.add(drawIndex);
      const { position, salt } = revealDraw(drawIndex, selectorState.current);
      publishReveal(db, roomId, {
        kind: "position",
        by: you,
        drawIndex,
        position,
        saltHex: saltToHex(salt),
      }).catch((err: unknown) => {
        // Clear the guard so the next render retries this index.
        console.error(`[useMultiplayerGame] position reveal ${drawIndex} failed to publish`, err);
        publishedPosition.current.delete(drawIndex);
      });
    }
  }, [db, roomId, you, role, protocolTick]);

  // Handle every incoming protocol message: verify it, and if I'm the
  // dealer, answer a fresh position reveal with the matching card reveal
  // (opening deal only in this task — Task 6 adds the face-down skip).
  useEffect(() => {
    if (!role) return;
    return subscribeToReveals(db, roomId, (reveal: ProtocolReveal) => {
      if (reveal.kind === "position") {
        updateProtocol(`position reveal ${reveal.drawIndex}`, async (cur) => {
          const next = await applyPositionReveal(
            cur,
            reveal.drawIndex,
            reveal.position,
            hexToSalt(reveal.saltHex),
          );
          answerWithCard(reveal.position);
          return next;
        });
      } else if (reveal.kind === "card") {
        updateProtocol(`card reveal ${reveal.position}`, (cur) =>
          applyCardReveal(
            cur,
            reveal.position,
            cardFromId(reveal.cardId),
            hexToSalt(reveal.saltHex),
          ),
        );
      }
    });

    // Dealer only: answer a position reveal with the card committed there.
    function answerWithCard(position: number): void {
      if (role !== "dealer" || !dealerState.current || publishedCard.current.has(position)) return;
      publishedCard.current.add(position);
      const { card, salt } = revealCard(position, dealerState.current);
      publishReveal(db, roomId, {
        kind: "card",
        by: you,
        position,
        cardId: cardId(card),
        saltHex: saltToHex(salt),
      }).catch((err: unknown) => {
        // Clear the guard so a replayed position reveal can retry.
        console.error(`[useMultiplayerGame] card reveal ${position} failed to publish`, err);
        publishedCard.current.delete(position);
      });
    }
  }, [db, roomId, you, role]);

  // Once a draw index in [0, 10) resolves, stash its card. Once all 10 are
  // in, dispatch one DEAL event — both clients compute this independently
  // from the same verified reveals, so no coordination is needed.
  useEffect(() => {
    if (!role || dealt.current) return;
    for (let i = 0; i < DEAL_SLOTS.length; i++) {
      if (dealBuffer.current.has(i)) continue;
      const card = resolvedDraw(protocol.current, i);
      if (card) dealBuffer.current.set(i, card);
    }
    if (dealBuffer.current.size < DEAL_SLOTS.length) return;
    dealt.current = true;
    const cards: Record<PlayerId, Card[]> = { p1: [], p2: [] };
    DEAL_SLOTS.forEach((slot, i) => {
      cards[slot.player][slot.hand] = dealBuffer.current.get(i)!;
    });
    dispatch({ type: "DEAL", cards });
    void publishTurnStarted(db, roomId);
  });

  return { state, getEvents };
}
