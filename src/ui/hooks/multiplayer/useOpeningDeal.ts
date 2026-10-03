import { useEffect, useRef } from "react";
import type { Card, PlayerId } from "../../../engine/types";
import { resolvedDraw } from "../../../crypto/protocolController";
import { DEAL_SLOTS } from "../../../crypto/drawSchedule";
import { publishTurnStarted } from "../../../net/roomState";
import type { MultiplayerCtx } from "./context";

/** Assembles the 10 verified opening-deal draws into one DEAL event. */
export function useOpeningDeal(ctx: MultiplayerCtx): void {
  const { db, roomId, role, protocol, dispatch } = ctx;
  const dealBuffer = useRef<Map<number, Card>>(new Map());
  const dealt = useRef(false);

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
}
