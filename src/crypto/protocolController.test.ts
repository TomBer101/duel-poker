import { describe, expect, test } from "vitest";
import {
  applyCardReveal,
  applyPositionReveal,
  createProtocolState,
  hasViolation,
  resolvedDraw,
  setCommitments,
} from "./protocolController";
import { generateDealerCommitments, generateSelectorCommitments } from "./protocol";
import { generateSeed } from "./commitment";

describe("protocolController", () => {
  test("resolves a draw once both halves verify", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    const selector = await generateSelectorCommitments(generateSeed());

    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);
    state = setCommitments(state, "selector", selector.commitments);

    const drawIndex = 0;
    const position = selector.drawOrder[drawIndex];
    state = await applyPositionReveal(state, drawIndex, position, selector.salts[drawIndex]);
    expect(resolvedDraw(state, drawIndex)).toBeNull(); // card half still missing

    const card = dealer.deck[position];
    state = await applyCardReveal(state, position, card, dealer.salts[position]);

    expect(resolvedDraw(state, drawIndex)).toEqual(card);
    expect(hasViolation(state)).toBe(false);
  });

  test("rejects a tampered position reveal", async () => {
    const selector = await generateSelectorCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "selector", selector.commitments);

    const wrongPosition = (selector.drawOrder[0] + 1) % 52;
    state = await applyPositionReveal(state, 0, wrongPosition, selector.salts[0]);

    expect(hasViolation(state)).toBe(true);
    expect(resolvedDraw(state, 0)).toBeNull();
  });

  test("rejects a tampered card reveal", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);

    const position = 3;
    const wrongCard = dealer.deck[(position + 1) % 52];
    state = await applyCardReveal(state, position, wrongCard, dealer.salts[position]);

    expect(hasViolation(state)).toBe(true);
  });

  test("card reveal before commitments are known is a violation, not a throw", async () => {
    const state = await applyCardReveal(
      createProtocolState(),
      0,
      { suit: "Hearts", rank: 14 },
      new Uint8Array(16),
    );
    expect(hasViolation(state)).toBe(true);
  });
});
