import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrikeIndicator } from "./StrikeIndicator";

describe("StrikeIndicator", () => {
  test("renders one dot per strike slot, filled dots equal to `strikes`", () => {
    render(<StrikeIndicator strikes={2} max={3} />);
    const dots = screen.getAllByTestId(/strike-dot-/);
    expect(dots).toHaveLength(3);
    expect(dots.filter((d) => d.dataset.filled === "true")).toHaveLength(2);
  });

  test("has an accessible label summarizing the count", () => {
    render(<StrikeIndicator strikes={1} max={3} />);
    expect(screen.getByLabelText("1 of 3 strikes")).toBeInTheDocument();
  });
});
