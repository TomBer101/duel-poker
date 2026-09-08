import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderedDeck } from "../../engine/testkit";
import { getLegalHands } from "../../engine/placement";
import { AI, HUMAN, REVEAL_STEP_MS, useGame } from "./useGame";

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

describe("useGame (solo)", () => {
  it("draw() stages the top deck card as pendingCard", () => {
    const deck = orderedDeck();
    const { result } = renderHook(() => useGame({ deck, firstTurn: HUMAN }));

    expect(result.current.state.pendingCard).toBeNull();
    act(() => result.current.draw());
    expect(result.current.state.pendingCard).toEqual(deck[0]);
    expect(result.current.state.drawCount).toBe(1);
  });

  it("after the human ends a turn, the AI plays its own and hands control back", () => {
    const { result } = renderHook(() =>
      useGame({ deck: orderedDeck(), firstTurn: HUMAN }),
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
    expect(aiCards).toBe(1);
  });

  it("plays a whole game: placing -> replace -> auto reveal -> result", () => {
    const { result } = renderHook(() =>
      useGame({ deck: orderedDeck(), firstTurn: HUMAN }),
    );

    // Placing: 25 human cards, each on the lowest legal hand. Between each the
    // AI takes its turn once timers are flushed.
    for (let i = 0; i < 25; i++) {
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
  });

  it("advances the reveal one hand per REVEAL_STEP_MS", () => {
    const { result } = renderHook(() =>
      useGame({ deck: orderedDeck(), firstTurn: HUMAN }),
    );
    for (let i = 0; i < 25; i++) {
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
