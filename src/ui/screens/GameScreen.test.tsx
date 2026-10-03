import { describe, expect, test, vi, beforeEach } from "vitest";
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
const mpState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../hooks/useSoloGame", () => ({ useSoloGame: () => handle }));
vi.mock("../hooks/multiplayer/useMultiplayerGame", () => ({
  useMultiplayerGame: () => ({ ...handle, state: mpState.current, you: "p2", hasViolation: false, claimWin }),
}));

vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => ({ client: { db: {} }, uid: "test-uid" }),
}));

// Not under test here (route selection only); the real hook talks to
// Firebase RTDB, which the fake `db: {}` above can't back. `vi.fn` (not a
// plain arrow) so the single call's args can be inspected below.
// No real Firebase presence listener under the fake `db: {}`.
vi.mock("../../net/sync", () => ({ subscribeToPresence: vi.fn(() => () => {}) }));

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
    expect(lastProps()).toEqual({ opponentPresent: true, onClaimWin: claimWin });
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
