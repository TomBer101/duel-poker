import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createInitialState } from "../../../engine/reducer";
import { createProtocolState } from "../../../crypto/protocolController";
import { fetchCommitments, fetchReveals, publishCommitments } from "../../../net/sync";
import type { ShuffleInput } from "./context";
import { useShuffle } from "./useShuffle";

vi.mock("../../../net/sync", () => ({
  fetchCommitments: vi.fn(),
  fetchReveals: vi.fn(),
  publishCommitments: vi.fn(),
  publishReveal: vi.fn(),
  subscribeToCommitments: vi.fn(() => () => {}),
  subscribeToReveals: vi.fn(() => () => {}),
}));
vi.mock("../../../net/roomState", () => ({
  subscribeToDealer: vi.fn((_db: unknown, _room: unknown, cb: (d: string) => void) => {
    cb("p1");
    return () => {};
  }),
}));

const failure = () => Promise.reject(new Error("network"));

function setup() {
  const ctx = {
    db: {},
    roomId: "R",
    you: "p1",
    gameNumber: 1,
    state: createInitialState({ mode: "multiplayer" }),
    protocol: { current: createProtocolState() },
    protocolTick: 0,
    bumpTick: vi.fn(),
    updateProtocol: vi.fn(),
    recordViolation: vi.fn(),
    refs: { batchPublished: { current: false }, resumed: { current: false } },
  } as unknown as ShuffleInput & { recordViolation: ReturnType<typeof vi.fn> };
  const hook = renderHook(() => useShuffle(ctx));
  return { ctx, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(fetchCommitments).mockResolvedValue(null);
  vi.mocked(fetchReveals).mockResolvedValue([]);
  vi.mocked(publishCommitments).mockResolvedValue();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useShuffle setup", () => {
  test("a transient read failure is retried; the setup then completes", async () => {
    vi.mocked(fetchReveals).mockImplementationOnce(failure);
    const { ctx, hook } = setup();
    await vi.waitFor(() => expect(publishCommitments).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(fetchReveals).toHaveBeenCalledTimes(2);
    expect(hook.result.current.dealerState.current).not.toBeNull();
    expect(ctx.recordViolation).not.toHaveBeenCalled();
  });

  test("a persistent read failure is a violation after the bounded attempts", async () => {
    vi.mocked(fetchReveals).mockImplementation(failure);
    const { ctx, hook } = setup();
    await vi.waitFor(() => expect(ctx.recordViolation).toHaveBeenCalledWith(expect.stringMatching(/shuffle setup failed: network/)), {
      timeout: 3000,
    });
    expect(fetchReveals).toHaveBeenCalledTimes(3);
    expect(publishCommitments).not.toHaveBeenCalled();
    expect(hook.result.current.dealerState.current).toBeNull();
  });

  test("unmounting during the retry delay stops the setup", async () => {
    vi.mocked(fetchReveals).mockImplementation(failure);
    const { ctx, hook } = setup();
    await vi.waitFor(() => expect(fetchReveals).toHaveBeenCalledTimes(1));
    hook.unmount();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(fetchReveals).toHaveBeenCalledTimes(1);
    expect(ctx.recordViolation).not.toHaveBeenCalled();
  });

  test("a rejected commitment publish that did land is not a violation", async () => {
    let written: string[] = [];
    vi.mocked(publishCommitments).mockImplementation(async (_db, _room, _role, c) => {
      written = c;
      throw new Error("ack lost");
    });
    vi.mocked(fetchCommitments).mockResolvedValueOnce(null).mockImplementation(async () => written);
    const { ctx } = setup();
    await vi.waitFor(() => expect(fetchCommitments).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.recordViolation).not.toHaveBeenCalled();
  });

  test("a rejected commitment publish that is not in the log is a violation", async () => {
    vi.mocked(publishCommitments).mockRejectedValueOnce(new Error("permission_denied"));
    const { ctx } = setup();
    await vi.waitFor(() => expect(ctx.recordViolation).toHaveBeenCalledWith(expect.stringMatching(/shuffle setup failed: permission_denied/)));
  });

  test("a resumed mount (my commitments already out) is flagged and publishes nothing", async () => {
    const first = setup();
    await vi.waitFor(() => expect(publishCommitments).toHaveBeenCalledTimes(1));
    const mine = vi.mocked(publishCommitments).mock.calls[0][3];
    expect(first.ctx.refs.resumed.current).toBe(false);
    first.hook.unmount();

    vi.mocked(fetchCommitments).mockResolvedValue(mine);
    const again = setup(); // same localStorage seed
    await vi.waitFor(() => expect(again.ctx.refs.resumed.current).toBe(true));
    expect(publishCommitments).toHaveBeenCalledTimes(1);
    expect(again.ctx.recordViolation).not.toHaveBeenCalled();
  });
});
