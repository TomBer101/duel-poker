import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameScreen } from "./GameScreen";
import { useRemoteTimer } from "../hooks/useRemoteTimer";

const handle = {
  state: { phase: "placing", pendingCard: null, hands: { p1: [], p2: [] }, strikes: { p1: 0, p2: 0 } },
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
vi.mock("../hooks/useMultiplayerGame", () => ({
  useMultiplayerGame: () => ({ ...handle, you: "p2", hasViolation: false }),
}));

vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => ({ client: { db: {} }, uid: "test-uid" }),
}));

// Not under test here (route selection only); the real hook talks to
// Firebase RTDB, which the fake `db: {}` above can't back. `vi.fn` (not a
// plain arrow) so calls can be inspected below: GameScreen wires TWO
// useRemoteTimer instances (display countdown vs. opponent-timeout
// detection) with deliberately different `active` gates, and a mock that
// only proves "didn't crash" can't catch the two call sites' configs
// being swapped or duplicated.
vi.mock("../hooks/useRemoteTimer", () => ({ useRemoteTimer: vi.fn(() => 60) }));

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

    // The mocked multiplayer handle has isHumanTurn: false (it's the
    // opponent's turn), so the two useRemoteTimer call sites must NOT be
    // interchangeable here: the display-countdown instance (args[2],
    // `active`) must be gated off, and the opponent-timeout-detection
    // instance must be gated on and wired to the same `g.timeout`
    // reference — catching a swapped/duplicated config between the two
    // call sites, not just "GameScreen didn't crash".
    const calls = vi.mocked(useRemoteTimer).mock.calls;
    expect(calls).toHaveLength(2);
    const [displayCall, detectionCall] = calls;
    expect(displayCall[2]).toBe(false); // display countdown: not my turn, so off
    expect(detectionCall[2]).toBe(true); // detection: opponent's turn, so on
    expect(detectionCall[4]).toBe(handle.timeout); // wired to report via g.timeout
  });
});
