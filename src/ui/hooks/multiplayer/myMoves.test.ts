import { beforeEach, describe, expect, test, vi } from "vitest";
import { gameReducer } from "../../../engine/reducer";
import { autoPlacePlacingPhase } from "../../../engine/testkit";
import type { GameState } from "../../../engine/types";
import { fetchReveals, newEventKey, publishEvent, publishReveal } from "../../../net/sync";
import { derivePlacementSalt } from "../../../crypto/protocol";
import { commitPlacement, createProtocolState } from "../../../crypto/protocolController";
import { publishTurnStarted } from "../../../net/roomState";
import { claimWin, commitOwnFaceDownCard, placePending, replace, timeout } from "./myMoves";
import { before, deck, dealt, drawn, endTurn, fakeCtx } from "./testCtx";

vi.mock("../../../net/sync", () => ({ newEventKey: vi.fn(), publishEvent: vi.fn(), publishReveal: vi.fn(), fetchReveals: vi.fn() }));
vi.mock("../../../net/roomState", () => ({ publishTurnStarted: vi.fn(), publishRematchVote: vi.fn() }));

const denied = () => Promise.reject(new Error("PERMISSION_DENIED: Permission denied"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(newEventKey).mockReturnValue("k1");
  vi.mocked(publishEvent).mockResolvedValue("k1");
  vi.mocked(publishReveal).mockResolvedValue();
  vi.mocked(fetchReveals).mockResolvedValue([]);
  vi.mocked(publishTurnStarted).mockResolvedValue();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("placePending — publish-then-apply", () => {
  test("registers the key before the write, publishes at lastSeq + 1 under it, applies only after the ack", async () => {
    const ctx = fakeCtx(drawn(before(10)), "p1", "selector");
    ctx.refs.lastSeq.current = 4;
    vi.mocked(publishEvent).mockImplementation(async () => {
      expect(ctx.refs.seenKeys.current.has("k1")).toBe(true); // echo may beat the ack
      expect(ctx.dispatch).not.toHaveBeenCalled();
      return "k1";
    });
    await placePending(ctx, [0, 1, 2, 3, 4], 0);
    expect(publishEvent).toHaveBeenCalledWith(ctx.db, "room", endTurn("p1", 0), { seq: 5, nextTurn: "p2", key: "k1" });
    expect(ctx.dispatch).toHaveBeenCalledWith(endTurn("p1", 0));
    expect(ctx.refs.lastSeq.current).toBe(5); // the intake moves past my position
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
    expect(ctx.refs.lastSeq.current).toBe(0); // position not taken: abandoned cleanly
    expect(ctx.bumpTick).toHaveBeenCalled(); // the queue re-checks without waiting for another render
  });
});

test("the selector's own TIMEOUT_HIDDEN report records the dealer's hidden draw", async () => {
  const ctx = fakeCtx(before(40), "p2", "selector"); // p1 (dealer) on its hidden draw-40 turn
  await timeout(ctx);
  expect(ctx.dispatch).toHaveBeenCalledWith({ type: "TIMEOUT_HIDDEN", by: "p1" });
  expect(ctx.updateProtocol).toHaveBeenCalledWith("hidden timeout draw", expect.any(Function));
  const step = ctx.updateProtocol.mock.calls[0][1] as (s: ReturnType<typeof createProtocolState>) => ReturnType<typeof createProtocolState>;
  expect(step(createProtocolState()).hiddenDraws).toEqual({ 0: 40 });
});

describe("commitOwnFaceDownCard (own hidden-timeout translation)", () => {
  const card = deck[40];
  const commitment = async () => commitPlacement(card, 0, await derivePlacementSalt(new Uint8Array(16), 0, 40));

  test("publishes the commit when the reveal log does not have it yet (live)", async () => {
    const ctx = fakeCtx(drawn(before(40)), "p1", "dealer");
    await commitOwnFaceDownCard(ctx, 0, card, 40);
    expect(publishReveal).toHaveBeenCalledWith(ctx.db, "room", { kind: "placementCommit", by: "p1", handIndex: 0, commitment: await commitment() });
    expect(ctx.refs.ownSlotDraw.current.get(0)).toBe(40);
  });

  test("never republishes an identical commit already in the log (catch-up); still rebuilds ownSlotDraw", async () => {
    vi.mocked(fetchReveals).mockResolvedValue([
      { kind: "placementCommit", by: "p1", handIndex: 0, commitment: await commitment() },
      { kind: "placementCommit", by: "p1", handIndex: 0, commitment: "later-swap" },
    ]);
    const ctx = fakeCtx(drawn(before(40)), "p1", "dealer");
    await commitOwnFaceDownCard(ctx, 0, card, 40);
    expect(publishReveal).not.toHaveBeenCalled();
    expect(ctx.refs.ownSlotDraw.current.get(0)).toBe(40);
  });

  test("without my dealer state: a recorded violation and a rejected commit, nothing published", async () => {
    const ctx = fakeCtx(drawn(before(40)), "p1", "dealer");
    (ctx.dealerState as { current: unknown }).current = null;
    await expect(commitOwnFaceDownCard(ctx, 0, card, 40)).rejects.toThrow(/without my dealer state/);
    expect(ctx.recordViolation).toHaveBeenCalledWith(expect.stringMatching(/without my dealer state/));
    expect(publishReveal).not.toHaveBeenCalled();
    expect(ctx.refs.ownSlotDraw.current.has(0)).toBe(false);
  });
});

test("claimWin publishes once while a claim is in flight", async () => {
  const ctx = fakeCtx(drawn(before(11)), "p1", "dealer");
  await Promise.all([claimWin(ctx), claimWin(ctx)]);
  expect(publishEvent).toHaveBeenCalledTimes(1);
  expect(ctx.dispatch).toHaveBeenCalledWith({ type: "FORFEIT", by: "p2" });
});
