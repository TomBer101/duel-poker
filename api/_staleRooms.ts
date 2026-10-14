type RoomMeta = { createdAt?: number; turnStartedAt?: number };
export type RoomsSnapshot = Record<string, { meta?: RoomMeta } | null> | null;

/**
 * Ids of rooms whose last activity — the later of `meta.createdAt` and
 * `meta.turnStartedAt` — is more than `maxAgeMs` before `now`. A room with no
 * timestamps (a half-created one) counts as stale.
 */
export function staleRoomIds(rooms: RoomsSnapshot, now: number, maxAgeMs: number): string[] {
  return Object.entries(rooms ?? {})
    .filter(([, room]) => Math.max(room?.meta?.createdAt ?? 0, room?.meta?.turnStartedAt ?? 0) < now - maxAgeMs)
    .map(([id]) => id);
}
