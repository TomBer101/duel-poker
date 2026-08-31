import { describe, expect, it } from "vitest";
import { projectHandStrength } from "./evaluate";
import { cards, card } from "../engine/testkit";

describe("projectHandStrength", () => {
  it("scores a card that makes a pair above one that only adds a high card", () => {
    const hand = cards("KH", "7D", "3S");
    const pairsTheKing = projectHandStrength(hand, card("KC"));
    const loneAce = projectHandStrength(hand, card("AC"));
    expect(pairsTheKing).toBeGreaterThan(loneAce);
  });

  it("ranks trips above a pair above nothing", () => {
    const nothing = projectHandStrength(cards("9H", "4D"), card("2S"));
    const pair = projectHandStrength(cards("9H", "4D"), card("9S"));
    const trips = projectHandStrength(cards("9H", "9D"), card("9S"));
    expect(pair).toBeGreaterThan(nothing);
    expect(trips).toBeGreaterThan(pair);
  });

  it("rewards building toward a flush", () => {
    const threeHearts = projectHandStrength(cards("2H", "7H", "9H"), card("KH"));
    const offSuit = projectHandStrength(cards("2H", "7H", "9H"), card("KS"));
    expect(threeHearts).toBeGreaterThan(offSuit);
  });

  it("rewards building toward a straight", () => {
    const connected = projectHandStrength(cards("6H", "7D", "8S"), card("9C"));
    const scattered = projectHandStrength(cards("6H", "7D", "8S"), card("2C"));
    expect(connected).toBeGreaterThan(scattered);
  });

  it("prefers a higher card when nothing else differs", () => {
    const high = projectHandStrength([], card("AH"));
    const low = projectHandStrength([], card("2H"));
    expect(high).toBeGreaterThan(low);
  });
});
