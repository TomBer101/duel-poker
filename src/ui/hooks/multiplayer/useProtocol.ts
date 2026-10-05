import { useRef, useState } from "react";
import { createProtocolState, hasViolation, type ProtocolControllerState } from "../../../crypto/protocolController";
import type { ProtocolHandle } from "./context";

/** Owns the protocol controller state and the ONE queue every mutation goes through. */
export function useProtocol(): ProtocolHandle {
  const protocol = useRef<ProtocolControllerState>(createProtocolState());
  const warned = useRef<Set<string>>(new Set());
  // Every protocol mutation (commitments AND reveals) goes through this one
  // promise chain. `applyPositionReveal`/`applyCardReveal` are async (they hash
  // via crypto.subtle.digest), so awaiting them concurrently and writing back
  // from a pre-await snapshot is a read-modify-write race — the last to
  // resolve would clobber the others. Each queued step instead reads
  // `protocol.current` only when it runs, so it always builds on the previous
  // step's result. A rejection is recorded as a violation and never breaks
  // the chain, so one bad message can't silently skip every later one.
  const protocolQueue = useRef<Promise<void>>(Promise.resolve());

  // `protocol` is a ref so its updates don't go through the reducer, but a
  // plain ref mutation alone never schedules a re-render — so effects that
  // depend on its contents (the selector's position reveals, the deal
  // assembly effect) would never re-run once new data lands. This tick
  // forces a render after every mutation (and after the local dealer/selector
  // state refs are set) so those effects re-check.
  const [protocolTick, setProtocolTick] = useState(0);
  const [violated, setViolated] = useState(false);
  const [violationReason, setViolationReason] = useState<string | null>(null);
  function bumpTick(): void {
    setProtocolTick((t) => t + 1);
    setViolated(hasViolation(protocol.current));
    setViolationReason(protocol.current.violations[0] ?? null);
  }
  function updateProtocol(
    what: string,
    step: (current: ProtocolControllerState) => ProtocolControllerState | Promise<ProtocolControllerState>,
  ): void {
    protocolQueue.current = protocolQueue.current
      .then(async () => {
        protocol.current = await step(protocol.current);
      })
      .catch((err: unknown) => {
        const message = `${what} failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[useMultiplayerGame] ${message}`);
        protocol.current = {
          ...protocol.current,
          violations: [...protocol.current.violations, message],
        };
      })
      .then(bumpTick);
  }

  function recordViolation(message: string): void {
    updateProtocol(message, (cur) => ({ ...cur, violations: [...cur.violations, message] }));
  }
  function warnOnce(key: string, message: string): void {
    if (warned.current.has(key)) return;
    warned.current.add(key);
    console.warn(`[useMultiplayerGame] ${message}`);
  }

  return { protocol, protocolTick, violated, violationReason, bumpTick, updateProtocol, recordViolation, warnOnce };
}
