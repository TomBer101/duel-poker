import { beforeEach, describe, expect, test, vi } from "vitest";
import { gameReducer } from "../../../engine/reducer";
import { autoPlacePlacingPhase } from "../../../engine/testkit";
import type { GameState } from "../../../engine/types";
import { newEventKey, publishEvent, publishReveal } from "../../../net/sync";
import { publishTurnStarted } from "../../../net/roomState";
import { claimWin, placePending, replace, timeout } from "./myMoves";
import { before, deck, dealt, drawn, endTurn, fakeCtx } from "./testCtx";

vi.mock("../../../net/sync", () => ({ newEventKey: vi.fn(), publishEvent: vi.fn(), publishReveal: vi.fn() }));
vi.mock("../../../net/roomState", () => ({ publishTurnStarted: vi.fn(), publishRematchVote: vi.fn() }));

const denied = () => Promise.reject(new Error("PERMISSION_DENIED: Permission denied"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(newEventKey).mockReturnValue("k1");
  vi.mocked(publishEvent).mockResolvedValue("k1");
  vi.mocked(publishReveal).mockResolvedValue();
  vi.mocked(publishTurnStarted).mockResolvedValue();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("placePending — publish-then-apply", () => {
  test("registers the key before the write, publishes under it, applies only after the ack", async () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    vi.mocked(publishEvent).mockImplementation(async () => {
      expect(ctx.refs.seenKeys.current.has("k1")).toBe(true); // echo may beat the ack
      expect(ctx.dispatch).not.toHaveBeenCalled();
      return "k1";
    });
    await placePending(ctx, [0, 1, 2, 3, 4], 0);
    expect(publishEvent).toHaveBeenCalledWith(ctx.db, "room", endTurn("p1", 0), "p2", "k1");
    expect(ctx.dispatch).toHaveBeenCalledWith(endTurn("p1", 0));
    expect(publishTurnStarted).toHaveBeenCalled();
  });

  test("a reducer throw after the publish is a violation", async () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    ctx.dispatch.mockImplementation(() => {
      throw new Error("[reducer] boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await placePending(ctx, [0], 0);
    expect(ctx.recordViolation).toHaveBeenCalledWith(expect.stringMatching(/local END_TURN failed/));
    expect(ctx.refs.placedForDraw.current).toBeNull();
  });
});

const replacing = (): GameState =>
  gameReducer(autoPlacePlacingPhase(dealt(), deck).state, { type: "REPLACE_DRAW", by: "p1", card: deck[50] });

type Row = {
  name: string;
  ctx: () => ReturnType<typeof fakeCtx>;
  move: (ctx: ReturnType<typeof fakeCtx>) => Promise<void>;
  guard: (ctx: ReturnType<typeof fakeCtx>) => unknown;
  committed?: boolean;
};
const rows: Row[] = [
  {
    name: "END_TURN",
    ctx: () => fakeCtx(drawn(before(10)), "p1", "selector"),
    move: (ctx) => placePending(ctx, [0], 0),
    guard: (ctx) => ctx.refs.placedForDraw.current,
  },
  {
    // Dealer's hidden placement: the commit still goes out first, but no
    // bookkeeping is recorded for a move that never happened.
    name: "hidden END_TURN (dealer)",
    ctx: () => fakeCtx(drawn(before(40)), "p1", "dealer"),
    move: (ctx) => placePending(ctx, [0], 0),
    guard: (ctx) => ctx.refs.placedForDraw.current,
    committed: true,
  },
  {
    name: "REPLACE (dealer swap)",
    ctx: () => fakeCtx(replacing(), "p1", "dealer"),
    move: (ctx) => replace(ctx, 2),
    guard: (ctx) => ctx.refs.replacedForDraw.current,
    committed: true,
  },
  {
    name: "TIMEOUT",
    ctx: () => fakeCtx(drawn(before(11)), "p1", "dealer"),
    move: (ctx) => timeout(ctx),
    guard: (ctx) => ctx.refs.timedOutForDraw.current,
  },
  {
    name: "FORFEIT",
    ctx: () => fakeCtx(drawn(before(11)), "p1", "dealer"),
    move: (ctx) => claimWin(ctx),
    guard: (ctx) => ctx.refs.claimedWin.current || null,
  },
];

describe("a rules denial leaves local state untouched and clears the in-flight guard", () => {
  test.each(rows)("$name", async ({ ctx: make, move, guard, committed }) => {
    vi.mocked(publishEvent).mockImplementation(denied);
    const ctx = make();
    await move(ctx);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.recordViolation).not.toHaveBeenCalled();
    expect(guard(ctx)).toBeNull();
    expect(ctx.refs.ownSlotDraw.current.size).toBe(0);
    expect(publishReveal).toHaveBeenCalledTimes(committed ? 1 : 0);
    expect(publishTurnStarted).not.toHaveBeenCalled();
  });
});

test("claimWin publishes once while a claim is in flight", async () => {
  const ctx = fakeCtx(drawn(before(11)), "p1", "dealer");
  await Promise.all([claimWin(ctx), claimWin(ctx)]);
  expect(publishEvent).toHaveBeenCalledTimes(1);
  expect(ctx.dispatch).toHaveBeenCalledWith({ type: "FORFEIT", by: "p2" });
});
