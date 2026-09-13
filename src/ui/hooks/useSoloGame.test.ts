import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderedDeck } from "../../engine/testkit";
import { getLegalHands } from "../../engine/placement";
import { REVEAL_STEP_MS } from "./useRevealPacer";
import { AI, HUMAN, useSoloGame } from "./useSoloGame";

// jsdom has no <audio>; stub it so the sfx manager is a silent no-op.
beforeEach(() => {
  vi.stubGlobal(
    "Audio",
    class {
      loop = false;
      currentTime = 0;
      play = () => Promise.resolve();
      pause = () => {};
      load = () => {};
      cloneNode = () => this;
    },
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Let queued timers fire. Each AI move chains draw -> place across two effects,
 * and a fresh effect's timer is only scheduled after the previous `act` flush,
 * so we run several rounds.
 */
function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    act(() => {
      vi.runOnlyPendingTimers();
    });
  }
}

/** Flush timer rounds until `pred()` holds (or `rounds` is exhausted). */
function flushUntil(pred: () => boolean, rounds = 10) {
  for (let i = 0; i < rounds && !pred(); i++) {
    act(() => {
      vi.runOnlyPendingTimers();
    });
  }
}

describe("useSoloGame", () => {
  it("deals one face-up card per hand before any turn is taken", () => {
    const deck = orderedDeck();
    const { result } = renderHook(() => useSoloGame({ deck, firstTurn: HUMAN }));

    expect(result.current.state.drawCount).toBe(10);
    expect(result.current.state.hands[HUMAN].map((h) => h.cards)).toEqual(
      deck.slice(0, 5).map((c) => [{ card: c, faceUp: true }]),
    );
    expect(result.current.state.hands[AI].map((h) => h.cards)).toEqual(
      deck.slice(5, 10).map((c) => [{ card: c, faceUp: true }]),
    );
  });

  it("deals exactly once under StrictMode's dev double-invoke of mount effects", () => {
    // main.tsx renders the whole app in <StrictMode>, which double-invokes a
    // fresh effect body against the same pre-render `state` closure. A naive
    // state-only guard dispatches DEAL twice and the second throws.
    const deck = orderedDeck();
    const { result } = renderHook(() => useSoloGame({ deck, firstTurn: HUMAN }), {
      wrapper: StrictMode,
    });
    expect(result.current.state.drawCount).toBe(10);
  });

  it("draw() stages the next deck card (after the opening deal) as pendingCard", () => {
    const deck = orderedDeck();
    const { result } = renderHook(() => useSoloGame({ deck, firstTurn: HUMAN }));

    expect(result.current.state.pendingCard).toBeNull();
    act(() => result.current.draw());
    expect(result.current.state.pendingCard).toEqual(deck[10]);
    expect(result.current.state.drawCount).toBe(11);
  });

  it("after the human ends a turn, the AI plays its own and hands control back", () => {
    const { result } = renderHook(() =>
      useSoloGame({ deck: orderedDeck(), firstTurn: HUMAN }),
    );

    act(() => result.current.draw());
    act(() => result.current.placePending(0));
    expect(result.current.state.turn).toBe(AI);

    flush();

    expect(result.current.state.turn).toBe(HUMAN);
    const aiCards = result.current.state.hands[AI].reduce(
      (n, h) => n + h.cards.length,
      0,
    );
    expect(aiCards).toBe(6); // 5 from the opening deal (1/hand) + 1 from this turn
  });

  it("plays a whole game: deal -> placing -> replace -> auto reveal -> result", () => {
    const { result } = renderHook(() =>
      useSoloGame({ deck: orderedDeck(), firstTurn: HUMAN }),
    );

    // Each hand already holds its dealt card, so placing needs 4 more per
    // hand (20 per seat), not 5. Between each the AI takes its turn once
    // timers are flushed.
    for (let i = 0; i < 20; i++) {
      act(() => result.current.draw());
      const hand = getLegalHands(result.current.state.hands[HUMAN])[0];
      act(() => result.current.placePending(hand));
      flush();
    }

    expect(result.current.state.phase).toBe("replace");

    // Replace: human passes, AI decides, both done -> reveal.
    act(() => result.current.replaceDraw());
    act(() => result.current.replace(null));
    flush();

    // Reveal auto-advances; flushing all timers runs every 3s beat.
    expect(["reveal", "result"]).toContain(result.current.state.phase);
    flush();
    expect(result.current.state.phase).toBe("result");
    expect(result.current.state.result).not.toBeNull();
    expect(["p1", "p2", "draw"]).toContain(result.current.state.result!.winner);

    // The append-only log grew alongside the derived state: 1 DEAL, then
    // 20 draws + 20 end-turns per seat, 2 replace-draws + 2 replaces, 5
    // reveal steps.
    expect(result.current.getEvents().length).toBe(90);
  });

  it("advances the reveal one hand per REVEAL_STEP_MS", () => {
    const { result } = renderHook(() =>
      useSoloGame({ deck: orderedDeck(), firstTurn: HUMAN }),
    );
    for (let i = 0; i < 20; i++) {
      act(() => result.current.draw());
      const hand = getLegalHands(result.current.state.hands[HUMAN])[0];
      act(() => result.current.placePending(hand));
      flush();
    }
    act(() => result.current.replaceDraw());
    act(() => result.current.replace(null));
    flushUntil(() => result.current.state.phase === "reveal");

    expect(result.current.state.phase).toBe("reveal");
    expect(result.current.state.revealIndex).toBe(0);

    act(() => vi.advanceTimersByTime(REVEAL_STEP_MS));
    expect(result.current.state.revealIndex).toBe(1);
  });
});
