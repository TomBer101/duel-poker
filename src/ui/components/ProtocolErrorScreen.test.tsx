import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProtocolErrorScreen } from "./ProtocolErrorScreen";

const renderScreen = (reason?: string | null) =>
  render(
    <MemoryRouter>
      <ProtocolErrorScreen reason={reason} />
    </MemoryRouter>,
  );

describe("ProtocolErrorScreen", () => {
  test("shows an error message and a Leave link back to home", () => {
    renderScreen();
    expect(screen.getByText(/protocol error/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /leave/i })).toHaveAttribute("href", "/");
  });

  test("shows the violation reason when given", () => {
    renderScreen("cannot resume this game: my selector seed is missing");
    expect(screen.getByText(/cannot resume this game: my selector seed is missing/)).toBeInTheDocument();
  });
});
