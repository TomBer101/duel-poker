import type { DragEndEvent } from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragPlacement } from "./useDragPlacement";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const dropOn = (id: string | null): DragEndEvent =>
  ({ over: id === null ? null : { id } }) as DragEndEvent;

describe("useDragPlacement", () => {
  it("places when the drop lands on a legal hand", () => {
    const onPlace = vi.fn();
    const { result } = renderHook(() =>
      useDragPlacement({ legalHands: [1, 3], onPlace }),
    );

    act(() => result.current.onDragStart());
    expect(result.current.dragging).toBe(true);

    act(() => result.current.onDragEnd(dropOn("hand-3")));
    expect(onPlace).toHaveBeenCalledWith(3);
    expect(result.current.dragging).toBe(false);
    expect(result.current.hint).toBeNull();
  });

  it("hints, does not place, on an illegal hand", () => {
    const onPlace = vi.fn();
    const { result } = renderHook(() =>
      useDragPlacement({ legalHands: [1, 3], onPlace }),
    );

    act(() => result.current.onDragEnd(dropOn("hand-0")));
    expect(onPlace).not.toHaveBeenCalled();
    expect(result.current.hint).toMatch(/shortest hands/i);

    act(() => vi.advanceTimersByTime(2600));
    expect(result.current.hint).toBeNull();
  });

  it("is a silent no-op when dropped away from any hand", () => {
    const onPlace = vi.fn();
    const { result } = renderHook(() =>
      useDragPlacement({ legalHands: [0], onPlace }),
    );

    act(() => result.current.onDragEnd(dropOn(null)));
    expect(onPlace).not.toHaveBeenCalled();
    expect(result.current.hint).toBeNull();
  });
});
