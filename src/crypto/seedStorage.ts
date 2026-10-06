import type { PlayerId } from "../engine/types";
import { SEED_BYTES } from "./commitment";

// Keyed by player as well as room/game: two clients sharing one browser
// profile (two tabs) must not load each other's seed.
function storageKey(roomId: string, gameNumber: number, player: PlayerId): string {
  return `duelPoker-${roomId}:${gameNumber}:${player}`;
}

export function saveSeed(
  roomId: string,
  gameNumber: number,
  player: PlayerId,
  seed: Uint8Array,
): void {
  localStorage.setItem(storageKey(roomId, gameNumber, player), JSON.stringify(Array.from(seed)));
}

/**
 * The stored seed, or null when it is missing OR malformed: anything but
 * exactly SEED_BYTES bytes (0..255) is never used.
 */
export function loadSeed(roomId: string, gameNumber: number, player: PlayerId): Uint8Array | null {
  const raw = localStorage.getItem(storageKey(roomId, gameNumber, player));
  if (raw === null) return null;
  let bytes: unknown;
  try {
    bytes = JSON.parse(raw);
  } catch {
    return null;
  }
  const valid =
    Array.isArray(bytes) &&
    bytes.length === SEED_BYTES &&
    bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);
  return valid ? new Uint8Array(bytes as number[]) : null;
}
