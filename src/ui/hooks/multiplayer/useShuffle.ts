import { useEffect, useRef, useState } from "react";
import { DECK_SIZE } from "../../../engine/constants";
import { cardFromId, cardId, otherPlayer } from "../../../engine/deck";
import type { PlayerId } from "../../../engine/types";
import { generateSeed, hexToSalt, saltToHex } from "../../../crypto/commitment";
import {
  generateDealerCommitments,
  generateSelectorCommitments,
  revealCard,
  revealDraw,
  type DealerCommitmentState,
  type SelectorCommitmentState,
} from "../../../crypto/protocol";
import {
  applyCardReveal,
  applyPlacementCommit,
  applyPositionReveal,
  receiveRevealBatch,
  setCommitments,
  type PlacementRevealWire,
} from "../../../crypto/protocolController";
import { loadSeed, saveSeed } from "../../../crypto/seedStorage";
import { DEAL_SLOTS, isFaceDownDraw, replaceDrawIndex } from "../../../crypto/drawSchedule";
import { publishCommitments, publishReveal, subscribeToCommitments, subscribeToReveals, type ProtocolReveal } from "../../../net/sync";
import { subscribeToDealer } from "../../../net/roomState";
import type { ShuffleHandle, ShuffleInput } from "./context";

/**
 * The commit-reveal shuffle: who deals, my 52 commitments, the opponent's
 * commitments, the selector's position reveals and every incoming protocol
 * message (incl. the dealer's card answers).
 */
export function useShuffle(ctx: ShuffleInput): ShuffleHandle {
  const { db, roomId, you, gameNumber, state, protocol, protocolTick, bumpTick, updateProtocol, recordViolation } = ctx;
  const [dealer, setDealer] = useState<PlayerId | null>(null);
  const role = dealer ? (dealer === you ? "dealer" : "selector") : null;
  const dealerState = useRef<DealerCommitmentState | null>(null);
  const selectorState = useRef<SelectorCommitmentState | null>(null);
  const publishedPosition = useRef<Set<number>>(new Set());
  const publishedCard = useRef<Set<number>>(new Set());

  // Who's dealer this game: latched on first delivery. Every game is a fresh
  // mount (GameScreen keys the body by gameNumber), so the dealer is constant
  // within a mount. Latching keeps a STALE instance from re-deriving its role
  // when a rematch reset flips protocol/dealer and republishing its old-seed
  // (write-once) commitments over the new game's.
  useEffect(() => subscribeToDealer(db, roomId, (d) => setDealer((cur) => cur ?? d)), [db, roomId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpTick only touches state setters and a ref (stable in effect); deps unchanged from the pre-split hook
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
  // draws are the separate effect below.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `protocol` is a ref (from useProtocol); protocolTick is what re-runs this
  }, [db, roomId, you, role, protocolTick]);

  // Per-turn counterpart of the eager opening-deal effect: reveal the position
  // for draw index `state.drawCount` (10..51). Gating on drawCount is safe here
  // (unlike the opening deal) because each index only becomes "next" after the
  // previous DRAW / PLACE_HIDDEN / REPLACE_* has advanced it.
  useEffect(() => {
    if (role !== "selector" || !selectorState.current) return;
    if (!protocol.current.dealerCommitments || !protocol.current.selectorCommitments) return;
    const drawIndex = state.drawCount;
    if (drawIndex < DEAL_SLOTS.length || drawIndex >= DECK_SIZE) return;
    if (publishedPosition.current.has(drawIndex)) return;
    publishedPosition.current.add(drawIndex);
    const { position, salt } = revealDraw(drawIndex, selectorState.current);
    publishReveal(db, roomId, {
      kind: "position",
      by: you,
      drawIndex,
      position,
      saltHex: saltToHex(salt),
    }).catch((err: unknown) => {
      console.error(`[useMultiplayerGame] position reveal ${drawIndex} failed to publish`, err);
      publishedPosition.current.delete(drawIndex);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `protocol` is a ref (from useProtocol); protocolTick is what re-runs this
  }, [db, roomId, you, role, state.drawCount, protocolTick]);

  // Handle every incoming protocol message: verify it, and if I'm the
  // dealer, answer a fresh position reveal with the matching card reveal.
  useEffect(() => {
    if (!role || !dealer) return;
    return subscribeToReveals(db, roomId, (reveal: ProtocolReveal) => {
      if (reveal.kind === "position") {
        updateProtocol(`position reveal ${reveal.drawIndex}`, async (cur) => {
          const next = await applyPositionReveal(
            cur,
            reveal.drawIndex,
            reveal.position,
            hexToSalt(reveal.saltHex),
          );
          answerWithCard(reveal.drawIndex, reveal.position);
          return next;
        });
      } else if (reveal.kind === "placementCommit") {
        updateProtocol(`placement commit ${String(reveal.handIndex)}`, (cur) =>
          applyPlacementCommit(cur, {
            by: reveal.by,
            dealer,
            handIndex: reveal.handIndex,
            commitment: reveal.commitment,
          }),
        );
      } else if (reveal.kind === "placementReveal") {
        if (reveal.by === you) return; // my own echo
        if (reveal.by !== otherPlayer(you)) {
          recordViolation(`placement reveal from unexpected sender ${String(reveal.by)}`);
          return;
        }
        // Firebase drops empty arrays.
        const rawCards: unknown = reveal.cards ?? [];
        if (!Array.isArray(rawCards)) {
          recordViolation("placement reveal batch is not a list");
          return;
        }
        updateProtocol(`placement reveal batch from ${reveal.by}`, (cur) =>
          receiveRevealBatch(cur, reveal.by, rawCards as PlacementRevealWire[]),
        );
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
    // Skipped on my own face-down turn: that card stays secret from the
    // selector until the reveal phase (I read it from my own deck instead).
    function answerWithCard(drawIndex: number, position: number): void {
      if (role !== "dealer" || !dealerState.current || publishedCard.current.has(position)) return;
      // Secret from the selector: my face-down placing draws and my own replace draw.
      if (isFaceDownDraw(drawIndex, you) || drawIndex === replaceDrawIndex(you)) return;
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
  }, [db, roomId, you, role, dealer]);

  return { dealer, role, dealerState, selectorState };
}
