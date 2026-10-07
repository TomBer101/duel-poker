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

  it("links Create Room to /lobby and Join Room to join mode", () => {
    render(
      <MemoryRouter>
        <HomeScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Create Room" })).toHaveAttribute(
      "href",
      "/lobby",
    );
    expect(screen.getByRole("link", { name: "Join Room" })).toHaveAttribute(
      "href",
      "/lobby?mode=join",
    );
  });
});
