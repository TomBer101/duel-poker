import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useLobby } from "./useLobby";

const fakeDb = {};
const fakeClient = { app: {}, db: fakeDb, auth: {} };

vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => ({ client: fakeClient, uid: "my-uid" }),
}));

const createRoom = vi.fn<(...args: unknown[]) => unknown>();
const joinRoom = vi.fn<(...args: unknown[]) => unknown>();
const leaveRoom = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("../../net/room", () => ({
  createRoom: (...args: unknown[]) => createRoom(...args),
  joinRoom: (...args: unknown[]) => joinRoom(...args),
  leaveRoom: (...args: unknown[]) => leaveRoom(...args),
}));

const setupPresence = vi.fn<(...args: unknown[]) => unknown>();
const subscribeToPresence = vi.fn<(...args: unknown[]) => () => void>(() => () => {});
const waitForConnection = vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
const disconnect = vi.fn();
vi.mock("../../net/sync", () => ({
  setupPresence: (...args: unknown[]) => setupPresence(...args),
  subscribeToPresence: (...args: unknown[]) => subscribeToPresence(...args),
  subscribeToConnection: () => () => {},
  waitForConnection: (...args: unknown[]) => waitForConnection(...args),
  connect: () => {},
  disconnect: (...args: unknown[]) => disconnect(...args),
}));

describe("useLobby", () => {
  test("creating a room seats you as p1", async () => {
    createRoom.mockResolvedValue("ABC123");
    const { result } = renderHook(() => useLobby());

    await act(async () => {
      await result.current.create("Alice", "hunter2");
    });

    expect(createRoom).toHaveBeenCalledWith(fakeDb, "my-uid", "Alice", "hunter2");
    expect(setupPresence).toHaveBeenCalledWith(fakeDb, "ABC123", "p1");
    expect(result.current.roomId).toBe("ABC123");
    expect(result.current.you).toBe("p1");
  });

  test("joining a room seats you as p2", async () => {
    joinRoom.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLobby());

    await act(async () => {
      await result.current.join("ABC123", "Bob", "hunter2");
    });

    expect(joinRoom).toHaveBeenCalledWith(fakeDb, "my-uid", "ABC123", "Bob", "hunter2");
    expect(setupPresence).toHaveBeenCalledWith(fakeDb, "ABC123", "p2");
    expect(result.current.roomId).toBe("ABC123");
    expect(result.current.you).toBe("p2");
  });

  test("surfaces a failed join as an error, without seating you", async () => {
    joinRoom.mockRejectedValue(new Error("incorrect password"));
    const { result } = renderHook(() => useLobby());

    await act(async () => {
      await result.current.join("ABC123", "Bob", "wrong");
    });

    expect(result.current.error).toBe("incorrect password");
    expect(result.current.roomId).toBeNull();
  });

  test("no connection within the wait: tables-occupied error, and no writes", async () => {
    createRoom.mockClear();
    waitForConnection.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useLobby());

    await act(async () => {
      await result.current.create("Alice", "hunter2");
    });

    expect(createRoom).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/All tables are occupied/);
    expect(result.current.busy).toBe(false);
    expect(result.current.roomId).toBeNull();
  });

  test("leaving the room closes the connection, even when the leave fails", async () => {
    createRoom.mockResolvedValue("ABC123");
    leaveRoom.mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useLobby());
    await act(async () => {
      await result.current.create("Alice", "hunter2");
    });

    await act(async () => {
      await result.current.leave();
    });

    expect(leaveRoom).toHaveBeenCalledWith(fakeDb, "ABC123", "p1");
    expect(disconnect).toHaveBeenCalledWith(fakeDb);
  });

  test("opponentPresent reflects the other seat's presence once subscribed", async () => {
    createRoom.mockResolvedValue("ABC123");
    let presenceCallback: ((p: Record<string, boolean>) => void) | undefined;
    subscribeToPresence.mockImplementation((..._args: unknown[]) => {
      presenceCallback = _args[2] as (p: Record<string, boolean>) => void;
      return () => {};
    });

    const { result } = renderHook(() => useLobby());
    await act(async () => {
      await result.current.create("Alice", "hunter2");
    });

    expect(result.current.opponentPresent).toBe(false);

    act(() => {
      presenceCallback?.({ p1: true, p2: true });
    });

    await waitFor(() => expect(result.current.opponentPresent).toBe(true));
  });
});
