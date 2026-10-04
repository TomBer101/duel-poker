import { describe, expect, test, vi } from "vitest";
import { gameReducer } from "../../../engine/reducer";
import { autoPlacePlacingPhase } from "../../../engine/testkit";
import type { GameEvent } from "../../../engine/types";
import { publishEvent, publishReveal } from "../../../net/sync";
import type { MultiplayerCtx } from "./context";
import { before, deck, dealt, drawn, endTurn, fakeCtx } from "./testCtx";
import { applyHead, enqueueOnce, type Queued } from "./useOpponentEvents";

vi.mock("../../../net/sync", () => ({
  subscribeToEvents: vi.fn(),
  publishEvent: vi.fn(),
  publishReveal: vi.fn(),
  newEventKey: vi.fn(),
}));
vi.mock("../../../net/roomState", () => ({ publishTurnStarted: vi.fn(), publishRematchVote: vi.fn() }));

describe("enqueueOnce (key dedupe)", () => {
  test("a duplicate delivery of the same key is queued once", () => {
    const seen = new Set<string>();
    const queue: Queued[] = [];
    expect(enqueueOnce(seen, queue, endTurn("p2", 0), "k1")).toBe(true);
    expect(enqueueOnce(seen, queue, endTurn("p2", 0), "k1")).toBe(false);
    expect(queue).toHaveLength(1);
  });

  test("my own live write (key registered before publishing) is ignored", () => {
    const seen = new Set(["mine"]);
    const queue: Queued[] = [];
    expect(enqueueOnce(seen, queue, endTurn("p1", 0), "mine")).toBe(false);
    expect(queue).toEqual([]);
  });

  test("an own-authored event with an unknown key (catch-up) is queued like any other", () => {
    const queue: Queued[] = [];
    expect(enqueueOnce(new Set(), queue, endTurn("p1", 0), "k1")).toBe(true);
    expect(queue).toEqual([{ key: "k1", event: endTurn("p1", 0) }]);
  });

  test("log order is preserved and malformed (by-less) entries are dropped", () => {
    const seen = new Set<string>();
    const queue: Queued[] = [];
    enqueueOnce(seen, queue, endTurn("p1", 0), "a");
    enqueueOnce(seen, queue, { type: "ADVANCE_REVEAL" }, "b");
    enqueueOnce(seen, queue, endTurn("p2", 1), "c");
    enqueueOnce(seen, queue, endTurn("p1", 0), "a");
    expect(queue.map((q) => q.key)).toEqual(["a", "c"]);
  });
});

function run(ctx: MultiplayerCtx, ...events: GameEvent[]) {
  const queue = { current: events.map((event, i) => ({ key: `k${i}`, event })) };
  applyHead(ctx, queue, { current: null });
  return queue.current;
}

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
