import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "./Timer";

beforeEach(() => {
  vi.stubGlobal(
    "Audio",
    class {
      loop = false;
      play = () => Promise.resolve();
      pause = () => {};
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Timer", () => {
  it("shows the label with no clock when there is no active countdown", () => {
    render(<Timer text="Opponent thinking…" />);
    expect(screen.getByText("Opponent thinking…")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("shows the clock once a countdown is given", () => {
    render(<Timer text="Your turn" secondsLeft={42} />);
    expect(screen.getByRole("timer")).toHaveTextContent("42");
    expect(screen.getByRole("timer")).toHaveAccessibleName("42 seconds left");
  });

  it("does not panic-style above the threshold, does at or below it", () => {
    const { rerender } = render(<Timer text="Your turn" secondsLeft={6} />);
    expect(screen.getByRole("timer").className).not.toMatch(/panic/);

    rerender(<Timer text="Your turn" secondsLeft={5} />);
    expect(screen.getByRole("timer").className).toMatch(/panic/);
  });
});
