import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { LobbyScreen } from "./LobbyScreen";

const create = vi.fn();
const join = vi.fn();
let lobbyState: ReturnType<typeof baseLobbyState>;

function baseLobbyState() {
  return {
    roomId: null as string | null,
    you: null as "p1" | "p2" | null,
    opponentPresent: false,
    error: null as string | null,
    busy: false,
    create,
    join,
  };
}

vi.mock("../hooks/useLobby", () => ({
  useLobby: () => lobbyState,
}));

function renderAt(path: string) {
  lobbyState = baseLobbyState();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lobby" element={<LobbyScreen />} />
        <Route path="/lobby/:roomId" element={<LobbyScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LobbyScreen — entry (no room yet)", () => {
  test("submitting the create form calls create() with nick and password", () => {
    renderAt("/lobby");

    fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));

    expect(create).toHaveBeenCalledWith("Alice", "hunter2");
  });

  test("create mode hides the room code field and Join button", () => {
    renderAt("/lobby");
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /join room/i })).toBeNull();
  });

  test("join mode hides the Create button", () => {
    renderAt("/lobby?mode=join");
    expect(screen.queryByRole("button", { name: /create room/i })).toBeNull();
  });

  test("submitting the join form calls join() with room id, nick, and password", () => {
    renderAt("/lobby?mode=join");

    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: "abc123" } });
    fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Bob" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));

    expect(join).toHaveBeenCalledWith("ABC123", "Bob", "hunter2");
  });

  test("pre-fills the room code from the URL when visiting /lobby/:roomId", () => {
    renderAt("/lobby/K3F9QZ");
    expect(screen.getByLabelText(/room code/i)).toHaveValue("K3F9QZ");
  });

  test("shows the error message from a failed join", () => {
    lobbyState = baseLobbyState();
    lobbyState.error = "incorrect password";

    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <Routes>
          <Route path="/lobby" element={<LobbyScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("incorrect password");
  });
});

describe("LobbyScreen — waiting room (room joined/created)", () => {
  test("shows the room code and a share hint once a room exists", () => {
    lobbyState = baseLobbyState();
    lobbyState.roomId = "K3F9QZ";
    lobbyState.you = "p1";

    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <Routes>
          <Route path="/lobby" element={<LobbyScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("K3F9QZ")).toBeInTheDocument();
  });

  test("Start Game is disabled until the opponent is present", () => {
    lobbyState = baseLobbyState();
    lobbyState.roomId = "K3F9QZ";
    lobbyState.you = "p1";
    lobbyState.opponentPresent = false;

    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <Routes>
          <Route path="/lobby" element={<LobbyScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
  });

  test("Start Game is enabled once the opponent is present", () => {
    lobbyState = baseLobbyState();
    lobbyState.roomId = "K3F9QZ";
    lobbyState.you = "p1";
    lobbyState.opponentPresent = true;

    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <Routes>
          <Route path="/lobby" element={<LobbyScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled();
  });
});
