import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen", () => {
  it("links Play Solo to /solo", () => {
    render(
      <MemoryRouter>
        <HomeScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Play Solo" })).toHaveAttribute(
      "href",
      "/solo",
    );
  });

  it("leaves Create/Join Room disabled — no multiplayer yet", () => {
    render(
      <MemoryRouter>
        <HomeScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Create Room" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join Room" })).toBeDisabled();
  });
});
