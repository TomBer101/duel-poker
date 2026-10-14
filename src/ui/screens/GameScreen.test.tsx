import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameScreen } from "./GameScreen";
import { TURN_TIMEOUT_MS } from "../../engine/constants";
import { useRemoteTimer } from "../hooks/useRemoteTimer";
import { subscribeToPresence } from "../../net/sync";
import { DisconnectOverlay } from "../components/DisconnectOverlay";

const handle = {
  state: { phase: "placing", turn: "p1", pendingCard: null, hands: { p1: [], p2: [] }, strikes: { p1: 0, p2: 0 } },
  you: "p1",
  legalHands: [],
  canDraw: false,
  isHumanTurn: false,
  aiThinking: false,
  draw: vi.fn(),
  placePending: vi.fn(),
  replaceDraw: vi.fn(),
  replace: vi.fn(),
  timeout: vi.fn(),
  playAgain: vi.fn(),
};

const claimWin = vi.hoisted(() => vi.fn());
const gn = vi.hoisted(() => ({
  deliver: null as null | ((n: number) => void),
  mounts: 0,
  calls: [] as { gameNumber: number; you: string }[],
}));
const mpState = vi.hoisted(() => ({ current: null as unknown }));
const violation = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("../hooks/useSoloGame", () => ({ useSoloGame: () => handle }));
vi.mock("../hooks/multiplayer/useMultiplayerGame", () => ({
  useMultiplayerGame: (opts: { gameNumber: number; you: string }) => {
    gn.calls.push(opts);
    useEffect(() => {
      gn.mounts++;
    }, []);
    return {
      ...handle,
      state: mpState.current,
      you: "p2",
      hasViolation: violation.current !== null,
      violationReason: violation.current,
      claimWin,
      rematchRequested: false,
    };
  },
}));

vi.mock("../../net/roomState", () => ({
  subscribeToScore: () => () => {},
  incrementScore: vi.fn(() => Promise.resolve()),
  subscribeToGameNumber: (_db: unknown, _room: string, cb: (n: number) => void) => {
    gn.deliver = cb;
    cb(1);
    return () => {};
  },
}));

const findSeat = vi.hoisted(() => vi.fn());
vi.mock("../../net/room", () => ({ findSeat }));

// Stable identity: the real context value is stable, and the outer screen's
// gameNumber subscription is keyed on `client.db`.
const fakeClient = vi.hoisted(() => ({ client: { db: {} }, uid: "test-uid" }));
vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => fakeClient,
}));

// Not under test here (route selection only); the real hook talks to
// Firebase RTDB, which the fake `db: {}` above can't back. `vi.fn` (not a
// plain arrow) so the single call's args can be inspected below.
// No real Firebase presence listener under the fake `db: {}`.
vi.mock("../../net/sync", () => ({
  subscribeToPresence: vi.fn(() => () => {}),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

// Props-capturing stub: these tests are about the wiring, not the countdown.
vi.mock("../components/DisconnectOverlay", () => ({ DisconnectOverlay: vi.fn(() => null) }));

vi.mock("../hooks/useRemoteTimer", () => ({ useRemoteTimer: vi.fn(() => 90) }));

mpState.current = handle.state;

describe("GameScreen route selection", () => {
  test("renders without crashing on /solo", () => {
    render(
      <MemoryRouter initialEntries={["/solo"]}>
        <Routes>
          <Route path="/solo" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
  });

  test("renders without crashing on /room/:roomId", () => {
    vi.mocked(useRemoteTimer).mockClear();
    sessionStorage.setItem("duelPoker-you-ABC123", "p2");
    render(
      <MemoryRouter initialEntries={["/room/ABC123"]}>
        <Routes>
          <Route path="/room/:roomId" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();

    // ONE turn-aware timer serves both turns: active during placing (here
    // regardless of whose turn), keyed by phase:turn, reporting via g.timeout.
    const calls = vi.mocked(useRemoteTimer).mock.calls;
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call[2]).toBe(true); // active: roomId && phase === "placing"
    expect(call[3]).toBe(TURN_TIMEOUT_MS);
    expect(call[4]).toBe(handle.timeout);
    expect(call[5]).toBe(`placing:${handle.state.turn}`);
  });
});

describe("GameScreen protocol violation", () => {
  const renderAt = (path: string, route: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => {
    sessionStorage.setItem("duelPoker-you-ABC123", "p2");
    mpState.current = handle.state;
    vi.mocked(DisconnectOverlay).mockClear();
  });
  afterEach(() => {
    violation.current = null;
  });

  test("multiplayer: a violation replaces the board (and overlays) with the error screen and reason", () => {
    violation.current = "cannot resume this game: seed missing";
    renderAt("/room/ABC123", "/room/:roomId");
    expect(screen.getByTestId("protocol-error")).toBeInTheDocument();
    expect(screen.getByText(/seed missing/)).toBeInTheDocument();
    expect(screen.queryByTestId("game-screen")).not.toBeInTheDocument();
    expect(DisconnectOverlay).not.toHaveBeenCalled();
  });

  test("multiplayer without a violation shows the board", () => {
    renderAt("/room/ABC123", "/room/:roomId");
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("protocol-error")).not.toBeInTheDocument();
  });

  test("solo ignores the multiplayer violation flag", () => {
    violation.current = "boom";
    renderAt("/solo", "/solo");
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("protocol-error")).not.toBeInTheDocument();
  });
});

describe("GameScreen rematch remount", () => {
  test("a new gameNumber remounts the body and re-calls the hook with it", () => {
    sessionStorage.setItem("duelPoker-you-ABC123", "p2");
    gn.mounts = 0;
    gn.calls.length = 0;
    render(
      <MemoryRouter initialEntries={["/room/ABC123"]}>
        <Routes>
          <Route path="/room/:roomId" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(gn.mounts).toBe(1);
    expect(gn.calls.at(-1)?.gameNumber).toBe(1);
    act(() => gn.deliver!(1)); // same game: no remount
    expect(gn.mounts).toBe(1);
    act(() => gn.deliver!(2));
    expect(gn.mounts).toBe(2);
    expect(gn.calls.at(-1)?.gameNumber).toBe(2);
  });
});

describe("GameScreen presence wiring (/room/:roomId, you = p2)", () => {
  let deliver: (presence: Partial<Record<"p1" | "p2", boolean>>) => void;
  const unsubscribe = vi.fn();

  function renderRoom() {
    return render(
      <MemoryRouter initialEntries={["/room/ABC123"]}>
        <Routes>
          <Route path="/room/:roomId" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const lastProps = () => vi.mocked(DisconnectOverlay).mock.lastCall?.[0];

  beforeEach(() => {
    sessionStorage.setItem("duelPoker-you-ABC123", "p2");
    mpState.current = handle.state;
    vi.mocked(DisconnectOverlay).mockClear();
    unsubscribe.mockClear();
    vi.mocked(subscribeToPresence).mockClear();
    vi.mocked(subscribeToPresence).mockImplementation((_db, _room, cb) => {
      deliver = cb;
      return unsubscribe;
    });
  });

  test("overlay is present-by-default (opponentPresent true) and wired to claimWin", () => {
    renderRoom();
    expect(lastProps()).toEqual({ opponentPresent: true, canClaim: false, onClaimWin: claimWin });
  });

  test.each([
    [0, false],
    [9, false],
    [10, true],
    [25, true],
  ])("a win is claimable only once the deal has happened (drawCount %i -> %s)", (drawCount, canClaim) => {
    mpState.current = { ...handle.state, drawCount };
    renderRoom();
    expect(lastProps()?.canClaim).toBe(canClaim);
  });

  test("opponent (p1) absent -> opponentPresent false; present again -> true", () => {
    renderRoom();
    act(() => deliver({ p1: false, p2: true }));
    expect(lastProps()?.opponentPresent).toBe(false);
    act(() => deliver({}));
    expect(lastProps()?.opponentPresent).toBe(false);
    act(() => deliver({ p1: true, p2: true }));
    expect(lastProps()?.opponentPresent).toBe(true);
  });

  test("my own presence flag does not count as the opponent's", () => {
    renderRoom();
    act(() => deliver({ p2: true }));
    expect(lastProps()?.opponentPresent).toBe(false);
  });

  test("not rendered once the game is in result", () => {
    mpState.current = { ...handle.state, phase: "result", result: null };
    renderRoom();
    expect(DisconnectOverlay).not.toHaveBeenCalled();
  });

  test("not rendered on /solo and presence is not subscribed", () => {
    render(
      <MemoryRouter initialEntries={["/solo"]}>
        <Routes>
          <Route path="/solo" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(DisconnectOverlay).not.toHaveBeenCalled();
    expect(subscribeToPresence).not.toHaveBeenCalled();
  });

  test("unsubscribes from presence on unmount", () => {
    const { unmount } = renderRoom();
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("GameScreen seat recovery (no seat stored in this tab)", () => {
  const renderRoom = (roomId: string) =>
    render(
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:roomId" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  beforeEach(() => {
    mpState.current = handle.state;
    gn.calls.length = 0;
    findSeat.mockReset();
  });

  test("a stored seat is used as is, without a lookup", () => {
    sessionStorage.setItem("duelPoker-you-STORED", "p2");
    renderRoom("STORED");
    expect(findSeat).not.toHaveBeenCalled();
    expect(gn.calls.at(-1)?.you).toBe("p2");
  });

  test("the seat is recovered from the room by auth uid", async () => {
    findSeat.mockResolvedValue("p2");
    renderRoom("NEWTAB");
    expect(await screen.findByTestId("game-screen")).toBeInTheDocument();
    expect(findSeat).toHaveBeenCalledWith(fakeClient.client.db, "NEWTAB", "test-uid");
    expect(gn.calls.every((c) => c.you === "p2")).toBe(true);
  });

  test.each([
    ["holds no seat", () => findSeat.mockResolvedValue(null)],
    ["lookup fails", () => findSeat.mockRejectedValue(new Error("offline"))],
  ])("%s: an error screen, never a guessed p1", async (_, arrange) => {
    arrange();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderRoom("STRANGER");
    expect(await screen.findByText("No seat in this room")).toBeInTheDocument();
    expect(screen.queryByTestId("game-screen")).not.toBeInTheDocument();
    expect(gn.calls).toHaveLength(0);
    err.mockRestore();
  });
});
