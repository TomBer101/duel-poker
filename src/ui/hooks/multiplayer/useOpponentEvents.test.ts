import { useEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createInitialState, gameReducer } from "../../../engine/reducer";
import { autoPlacePlacingPhase } from "../../../engine/testkit";
import type { GameEvent } from "../../../engine/types";
import { publishEvent, publishReveal } from "../../../net/sync";
import { createProtocolState } from "../../../crypto/protocolController";
import { useGameEngine } from "../useGameEngine";
import type { MultiplayerCtx } from "./context";
import { before, deck, dealt, drawn, endTurn, fakeCtx } from "./testCtx";
import { useTurnDraws } from "./useTurnDraws";
import { applyHead, enqueueOnce, type Queued } from "./useOpponentEvents";

vi.mock("../../../net/sync", () => ({
  subscribeToEvents: vi.fn(),
  publishEvent: vi.fn(),
  publishReveal: vi.fn(),
  newEventKey: vi.fn(),
}));
vi.mock("../../sound/gameSounds", () => ({ playEventSfx: () => {}, playResultSting: () => {} }));
vi.mock("../../../net/roomState", () => ({ publishTurnStarted: vi.fn(), publishRematchVote: vi.fn() }));

describe("enqueueOnce (key dedupe, seq order)", () => {
  test("a duplicate delivery of the same key is queued once", () => {
    const seen = new Set<string>();
    const queue: Queued[] = [];
    expect(enqueueOnce(seen, queue, endTurn("p2", 0), "k1", 1)).toBe(true);
    expect(enqueueOnce(seen, queue, endTurn("p2", 0), "k1", 1)).toBe(false);
    expect(queue).toHaveLength(1);
  });

  test("my own live write (key registered before publishing) is ignored", () => {
    const seen = new Set(["mine"]);
    const queue: Queued[] = [];
    expect(enqueueOnce(seen, queue, endTurn("p1", 0), "mine", 1)).toBe(false);
    expect(queue).toEqual([]);
  });

  test("an own-authored event with an unknown key (catch-up) is queued like any other", () => {
    const queue: Queued[] = [];
    expect(enqueueOnce(new Set(), queue, endTurn("p1", 0), "k1", 1)).toBe(true);
    expect(queue).toEqual([{ key: "k1", seq: 1, event: endTurn("p1", 0) }]);
  });

  test("out-of-order deliveries are sorted by seq (not key / arrival order); malformed entries dropped", () => {
    const seen = new Set<string>();
    const queue: Queued[] = [];
    enqueueOnce(seen, queue, endTurn("p2", 1), "a", 3);
    enqueueOnce(seen, queue, endTurn("p1", 0), "b", 1);
    enqueueOnce(seen, queue, { type: "ADVANCE_REVEAL" }, "c", 4);
    enqueueOnce(seen, queue, endTurn("p1", 0), "d", 2);
    enqueueOnce(seen, queue, endTurn("p1", 0), "b", 1);
    expect(queue.map((q) => q.seq)).toEqual([1, 2, 3]);
  });
});

/** Queues `events` at seq lastSeq+1.. and runs one intake step. */
function run(ctx: ReturnType<typeof fakeCtx>, ...events: GameEvent[]) {
  return runAt(ctx, events.map((event, i) => ({ seq: ctx.refs.lastSeq.current + 1 + i, event })));
}
function runAt(ctx: ReturnType<typeof fakeCtx>, items: { seq: number; event: GameEvent }[]) {
  const queue = { current: items.map(({ seq, event }) => ({ key: `k${seq}`, seq, event })) };
  applyHead(ctx, queue, { current: null });
  return queue.current;
}

describe("applyHead — seq order", () => {
  test("a gap (head is not lastSeq + 1) waits; the missing event fills it", () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    expect(runAt(ctx, [{ seq: 2, event: endTurn("p1", 0) }])).toHaveLength(1);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(runAt(ctx, [{ seq: 1, event: endTurn("p1", 0) }])).toHaveLength(0);
    expect(ctx.dispatch).toHaveBeenCalledWith(endTurn("p1", 0));
    expect(ctx.refs.lastSeq.current).toBe(1);
  });

  test("a head at or below lastSeq (already applied) is dropped without dispatch", () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    ctx.refs.lastSeq.current = 3;
    expect(runAt(ctx, [{ seq: 3, event: endTurn("p1", 0) }])).toHaveLength(0);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.refs.lastSeq.current).toBe(3);
  });

  test("nothing happens while an earlier effect's dispatch is pending (stale snapshot)", () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    ctx.hasPendingDispatch = () => true;
    expect(run(ctx, endTurn("p1", 0))).toHaveLength(1);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  test("a rejected head is consumed: lastSeq advances past it", () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "dealer");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(run(ctx, endTurn("p1", 0, true))).toHaveLength(0);
    expect(ctx.recordViolation).toHaveBeenCalled();
    expect(ctx.refs.lastSeq.current).toBe(1);
  });
});

describe("applyHead — own-authored events (catch-up)", () => {
  test("my END_TURN waits for my card, then applies unchanged", () => {
    const waiting = fakeCtx(before(10), "p1", "selector");
    expect(run(waiting, endTurn("p1", 0))).toHaveLength(1);
    expect(waiting.dispatch).not.toHaveBeenCalled();

    const ready = fakeCtx(drawn(before(10)), "p1", "selector");
    expect(run(ready, endTurn("p1", 0))).toHaveLength(0);
    expect(ready.dispatch).toHaveBeenCalledWith(endTurn("p1", 0));
    expect(ready.recordViolation).not.toHaveBeenCalled();
  });

  test("my END_TURN whose faceDown flag contradicts the local rules is rejected", () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "dealer");
    expect(run(ctx, endTurn("p1", 0, true))).toHaveLength(0);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.recordViolation).toHaveBeenCalledWith(expect.stringMatching(/^own END_TURN faceDown=true/));
  });

  test("the dealer's own hidden END_TURN applies as END_TURN and rebuilds ownSlotDraw without publishing", () => {
    // Draw 40 is p1's first face-down turn.
    const ctx = fakeCtx(drawn(before(40)), "p1", "dealer");
    expect(run(ctx, endTurn("p1", 0, true))).toHaveLength(0);
    expect(ctx.dispatch).toHaveBeenCalledWith(endTurn("p1", 0, true));
    expect(ctx.refs.ownSlotDraw.current.get(0)).toBe(40);
    expect(publishReveal).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test("the selector still translates the dealer's hidden END_TURN to PLACE_HIDDEN", () => {
    const ctx = fakeCtx(before(40), "p2", "selector");
    expect(run(ctx, endTurn("p1", 0, true))).toHaveLength(0);
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: "PLACE_HIDDEN", by: "p1", handIndex: 0 });
  });

  test("my REPLACE waits for my REPLACE_DRAW, then applies unchanged; a dealer swap rebuilds ownSlotDraw", () => {
    const replacing = autoPlacePlacingPhase(dealt(), deck).state;
    const waiting = fakeCtx(replacing, "p1", "dealer");
    const swap: GameEvent = { type: "REPLACE", by: "p1", handIndex: 2 };
    expect(run(waiting, swap)).toHaveLength(1);
    expect(waiting.dispatch).not.toHaveBeenCalled();

    const ready = fakeCtx(gameReducer(replacing, { type: "REPLACE_DRAW", by: "p1", card: deck[50] }), "p1", "dealer");
    expect(run(ready, swap)).toHaveLength(0);
    expect(ready.dispatch).toHaveBeenCalledWith(swap);
    expect(ready.refs.ownSlotDraw.current.get(2)).toBe(50);
    expect(publishReveal).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test("a TIMEOUT_HIDDEN I (the selector) wrote about the dealer records the hidden draw", () => {
    const ctx = fakeCtx(before(40), "p2", "selector");
    expect(run(ctx, { type: "TIMEOUT_HIDDEN", by: "p1" })).toHaveLength(0);
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: "TIMEOUT_HIDDEN", by: "p1" });
    expect(ctx.updateProtocol).toHaveBeenCalledWith("hidden timeout draw", expect.any(Function));
    const step = ctx.updateProtocol.mock.calls[0][1] as (s: ReturnType<typeof createProtocolState>) => ReturnType<typeof createProtocolState>;
    expect(step(createProtocolState()).hiddenDraws).toEqual({ 0: 40 });
  });

  test("a TIMEOUT / FORFEIT I wrote about the opponent applies as written", () => {
    const opponentsTurn = drawn(before(11)); // p2 on turn with a resolved card
    const timeout: GameEvent = { type: "TIMEOUT", by: "p2", card: opponentsTurn.pendingCard! };
    const ctx = fakeCtx(opponentsTurn, "p1", "dealer");
    expect(run(ctx, timeout)).toHaveLength(0);
    expect(ctx.dispatch).toHaveBeenCalledWith(timeout);

    const forfeit = fakeCtx(opponentsTurn, "p1", "dealer");
    expect(run(forfeit, { type: "FORFEIT", by: "p2" })).toHaveLength(0);
    expect(forfeit.dispatch).toHaveBeenCalledWith({ type: "FORFEIT", by: "p2" });
  });
});

describe("same-commit stale snapshot (intake + per-turn DRAW effect)", () => {
  /**
   * The real effect order of the root hook (intake, then the DRAW effect) over
   * the real engine. p2 is on turn with no card yet; in ONE commit the
   * opponent's TIMEOUT about p2 is queued AND p2's draw becomes resolvable.
   */
  function harness(guard: boolean) {
    const queue = { current: [] as Queued[] };
    const protocol = { current: createProtocolState() };
    const base = fakeCtx(createInitialState({ mode: "multiplayer" }), "p1", "dealer");
    const hook = renderHook(() => {
      const engine = useGameEngine({ mode: "multiplayer" });
      const ctx = {
        ...base,
        state: engine.state,
        dispatch: engine.dispatch,
        hasPendingDispatch: guard ? engine.hasPendingDispatch : () => false,
        protocol,
        dealerState: { current: null },
      } as unknown as MultiplayerCtx;
      useEffect(() => applyHead(ctx, queue, { current: null }));
      useTurnDraws(ctx);
      return engine;
    });
    act(() => {
      const { dispatch } = hook.result.current;
      dispatch({ type: "DEAL", cards: { p1: deck.slice(0, 5), p2: deck.slice(5, 10) } });
      dispatch({ type: "DRAW", by: "p1", card: deck[10] });
      dispatch(endTurn("p1", 0));
    });
    const trigger = () =>
      act(() => {
        protocol.current = { ...protocol.current, positions: { 11: 11 }, cards: { 11: deck[11] } };
        queue.current.push({ key: "t", seq: 1, event: { type: "TIMEOUT", by: "p2", card: deck[11] } });
        hook.rerender();
      });
    return { hook, trigger };
  }

  test("an opponent TIMEOUT applied while the DRAW is resolvable does not double-dispatch", () => {
    const { hook, trigger } = harness(true);
    trigger();
    const s = hook.result.current.state;
    expect(s.strikes.p2).toBe(1);
    expect(s.turn).toBe("p1");
    expect(s.drawCount).toBe(12);
    expect(s.pendingCard).toBeNull();
    expect(hook.result.current.getEvents().filter((e) => e.type === "DRAW")).toHaveLength(1);
  });

  test("without the pending-dispatch guard the same commit throws (the race this guards)", () => {
    const { trigger } = harness(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(trigger).toThrow(/not p2's turn/);
  });
});
