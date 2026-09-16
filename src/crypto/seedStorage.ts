function storageKey(roomId: string, gameNumber: number): string {
  return `duelPoker-${roomId}:${gameNumber}`;
}

export function saveSeed(roomId: string, gameNumber: number, seed: Uint8Array): void {
  localStorage.setItem(storageKey(roomId, gameNumber), JSON.stringify(Array.from(seed)));
}

export function loadSeed(roomId: string, gameNumber: number): Uint8Array | null {
  const raw = localStorage.getItem(storageKey(roomId, gameNumber));
  if (raw === null) return null;
  return new Uint8Array(JSON.parse(raw) as number[]);
}
