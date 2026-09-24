import type { PlayerId } from "../engine/types";

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

export function loadSeed(roomId: string, gameNumber: number, player: PlayerId): Uint8Array | null {
  const raw = localStorage.getItem(storageKey(roomId, gameNumber, player));
  if (raw === null) return null;
  return new Uint8Array(JSON.parse(raw) as number[]);
}
