import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameScreen } from "./GameScreen";
import { TURN_TIMEOUT_MS } from "../../engine/constants";
import { useRemoteTimer } from "../hooks/useRemoteTimer";

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

vi.mock("../hooks/useSoloGame", () => ({ useSoloGame: () => handle }));
vi.mock("../hooks/multiplayer/useMultiplayerGame", () => ({
  useMultiplayerGame: () => ({ ...handle, you: "p2", hasViolation: false }),
}));

vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => ({ client: { db: {} }, uid: "test-uid" }),
}));

// Not under test here (route selection only); the real hook talks to
// Firebase RTDB, which the fake `db: {}` above can't back. `vi.fn` (not a
// plain arrow) so the single call's args can be inspected below.
vi.mock("../hooks/useRemoteTimer", () => ({ useRemoteTimer: vi.fn(() => 90) }));

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
