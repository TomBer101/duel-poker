import { describe, expect, test } from "vitest";
import {
  generateDealerCommitments,
  generateSelectorCommitments,
  revealCard,
  revealDraw,
  verifyCard,
  verifyDraw,
} from "./protocol";
import { DECK_SIZE } from "../engine/constants";

const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

describe("generateDealerCommitments", () => {
  test("same seed always produces the same deck (commitments use fresh random salts)", async () => {
    const a = await generateDealerCommitments(seed);
    const b = await generateDealerCommitments(seed);
    expect(a.deck).toEqual(b.deck);
    expect(a.commitments).not.toEqual(b.commitments);
  });

  test("produces one commitment per card", async () => {
    const { deck, commitments } = await generateDealerCommitments(seed);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(commitments).toHaveLength(DECK_SIZE);
  });
});

describe("generateSelectorCommitments", () => {
  test("same seed always produces the same draw order (commitments use fresh random salts)", async () => {
    const a = await generateSelectorCommitments(seed);
    const b = await generateSelectorCommitments(seed);
    expect(a.drawOrder).toEqual(b.drawOrder);
    expect(a.commitments).not.toEqual(b.commitments);
  });

  test("produces one commitment per draw index", async () => {
    const { drawOrder, commitments } = await generateSelectorCommitments(seed);
    expect(drawOrder).toHaveLength(DECK_SIZE);
    expect(commitments).toHaveLength(DECK_SIZE);
  });
});

describe("full commit -> reveal -> verify round trip", () => {
  test("verifies every card and every draw across all 52 positions", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const selectorState = await generateSelectorCommitments(seed);

    for (let i = 0; i < DECK_SIZE; i++) {
      const drawReveal = revealDraw(i, selectorState);
      await expect(verifyDraw(drawReveal, selectorState.commitments[i])).resolves.toBe(
        true,
      );

      const cardReveal = revealCard(drawReveal.position, dealerState);
      await expect(
        verifyCard(cardReveal, dealerState.commitments[drawReveal.position]),
      ).resolves.toBe(true);
    }
  });

  test("detects a tampered card reveal", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const cardReveal = revealCard(0, dealerState);
    const tampered = { ...cardReveal, card: dealerState.deck[1] };
    await expect(verifyCard(tampered, dealerState.commitments[0])).resolves.toBe(false);
  });

  test("detects a tampered salt on a card reveal", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const otherState = await generateDealerCommitments(new Uint8Array([9, 9, 9]));
    const cardReveal = revealCard(0, dealerState);
    const tampered = { ...cardReveal, salt: otherState.salts[0] };
    await expect(verifyCard(tampered, dealerState.commitments[0])).resolves.toBe(false);
  });

  test("detects a tampered draw reveal", async () => {
    const selectorState = await generateSelectorCommitments(seed);
    const drawReveal = revealDraw(0, selectorState);
    const tampered = { ...drawReveal, position: (drawReveal.position + 1) % DECK_SIZE };
    await expect(verifyDraw(tampered, selectorState.commitments[0])).resolves.toBe(
      false,
    );
  });
});
