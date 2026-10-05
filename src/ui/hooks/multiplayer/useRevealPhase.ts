import { useEffect, useRef } from "react";
import { CARDS_PER_HAND, HANDS_PER_PLAYER } from "../../../engine/constants";
import { cardId, otherPlayer } from "../../../engine/deck";
import type { Card, PlayerId } from "../../../engine/types";
import { saltToHex } from "../../../crypto/commitment";
import { derivePlacementSalt, revealCard } from "../../../crypto/protocol";
import { applyPlacementReveal, hasViolation, type PlacementRevealWire } from "../../../crypto/protocolController";
import { publishReveal } from "../../../net/sync";
import type { MultiplayerCtx } from "./context";

const MAX_BATCH_PUBLISH_ATTEMPTS = 3;
const BATCH_RETRY_DELAY_MS = 500;

/** The reveal phase: publish my batch, verify the opponent's, dispatch REVEAL_FACE_DOWN. */
export function useRevealPhase(ctx: MultiplayerCtx): void {
  const { db, roomId, you, role, state, dispatch, hasPendingDispatch, protocol, dealerState, bumpTick, updateProtocol, recordViolation, warnOnce, refs } =
    ctx;
  const { ownSlotDraw, batchPublished: batchPublishedRef } = refs;
  const batchFailures = useRef(0);
  const verifyQueued = useRef(false);
  const revealDispatched = useRef(false);

  // Reveal phase, step 1: publish ONE batch of the face-down cards the opponent
  // cannot know (the dealer's five 5th cards; the selector's is empty). Each
  // entry names the draw that produced the card and its deck salt, binding
  // the reveal to the dealer's own deck commitments (not just its placement
  // commitment, which a cheating dealer could have fabricated for any card).
  useEffect(() => {
    if (!role || hasPendingDispatch() || state.phase !== "reveal" || batchPublishedRef.current) return;
    batchPublishedRef.current = true;
    const entries: { handIndex: number; card: Card; drawIndex: number; position: number }[] = [];
    if (role === "dealer") {
      for (let handIndex = 0; handIndex < HANDS_PER_PLAYER; handIndex++) {
        const card = state.hands[you][handIndex].cards[CARDS_PER_HAND - 1]?.card;
        const drawIndex = ownSlotDraw.current.get(handIndex);
        const position = drawIndex === undefined ? undefined : protocol.current.positions[drawIndex];
        if (!card || drawIndex === undefined || position === undefined || !dealerState.current) {
          warnOnce(
            `batch-missing:${handIndex}`,
            `own face-down card/draw for hand ${handIndex} missing; batch not published`,
          );
          recordViolation(`own face-down card/draw for hand ${handIndex} missing`);
          batchPublishedRef.current = false;
          return;
        }
        entries.push({ handIndex, card, drawIndex, position });
      }
    }
    const dealer = dealerState.current;
    // Placement salts are derived from the seed (the same derivation the
    // placementCommit used), so a refreshed client can rebuild them too.
    Promise.all(
      entries.map(
        async ({ handIndex, card, drawIndex, position }): Promise<PlacementRevealWire> => ({
          handIndex,
          cardId: cardId(card),
          saltHex: saltToHex(await derivePlacementSalt(dealer!.seed, handIndex, drawIndex)),
          drawIndex,
          deckSaltHex: saltToHex(revealCard(position, dealer!).salt),
        }),
      ),
    )
      .then((cards) => publishReveal(db, roomId, { kind: "placementReveal", by: you, cards }))
      .catch((err: unknown) => {
        console.error("[useMultiplayerGame] failed to publish placement reveal batch", err);
        batchFailures.current += 1;
        if (batchFailures.current >= MAX_BATCH_PUBLISH_ATTEMPTS) {
          recordViolation(`placement reveal batch failed to publish after ${batchFailures.current} attempts`);
          return; // stop retrying, stay latched as a hard failure
        }
        batchPublishedRef.current = false; // allow a retry
        setTimeout(bumpTick, BATCH_RETRY_DELAY_MS); // force the next render to re-run this effect
      });
  });

  // Reveal phase, step 1b: once the opponent's raw batch has arrived, verify
  // it (deck-bound; see step 1) exactly once.
  useEffect(() => {
    if (!role || hasPendingDispatch() || state.phase !== "reveal" || verifyQueued.current) return;
    const opponent = otherPlayer(you);
    const raw = protocol.current.receivedBatches[opponent];
    if (!raw) return;
    verifyQueued.current = true;
    updateProtocol(`placement reveal verification from ${opponent}`, (cur) =>
      applyPlacementReveal(cur, opponent, raw),
    );
  });

  // Reveal phase, step 2: once the opponent's batch verified, fill every
  // still-unknown face-down slot with ONE REVEAL_FACE_DOWN.
  useEffect(() => {
    if (!role || hasPendingDispatch() || state.phase !== "reveal" || revealDispatched.current) return;
    if (hasViolation(protocol.current)) return;
    const theirs = protocol.current.revealBatches[otherPlayer(you)];
    if (!theirs) return;
    const build = (player: PlayerId): Card[] | null => {
      const out: Card[] = [];
      for (let i = 0; i < HANDS_PER_PLAYER; i++) {
        const known = state.hands[player][i].cards[CARDS_PER_HAND - 1]?.card;
        const card = known ?? (player === you ? undefined : theirs[i]);
        if (!card) return null;
        out.push(card);
      }
      return out;
    };
    const p1Cards = build("p1");
    const p2Cards = build("p2");
    revealDispatched.current = true;
    if (!p1Cards || !p2Cards) {
      recordViolation("opponent reveal batch does not cover every unknown face-down card");
      return;
    }
    try {
      dispatch({ type: "REVEAL_FACE_DOWN", cards: { p1: p1Cards, p2: p2Cards } });
    } catch (err) {
      console.error("[useMultiplayerGame] REVEAL_FACE_DOWN rejected by reducer", err);
      recordViolation(`REVEAL_FACE_DOWN failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
