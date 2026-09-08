import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";

// Smoke test: also the canary that the UI test toolchain (jsdom + JSX transform
// + jest-dom matchers) is wired up correctly.
describe("HomeScreen", () => {
  it("renders", () => {
    render(<HomeScreen />);
    expect(screen.getByText("Home Screen")).toBeInTheDocument();
  });
});
