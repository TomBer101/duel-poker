import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { staleRoomIds } from "./_staleRooms.js";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Daily Vercel Cron (see vercel.json): deletes rooms idle for over 24h. RTDB
 * has no TTL, and a tab killed mid-game never runs leaveRoom. Runs with the
 * service account (bypasses the rules), so only Vercel's cron may call it.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? "")),
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
    });
  const rooms = getDatabase(app).ref("rooms");
  // ponytail: reads every room once a day; fine at ~30 KB a room, switch to an
  // indexed query on meta timestamps if the room count ever grows large.
  const ids = staleRoomIds((await rooms.get()).val(), Date.now(), MAX_AGE_MS);
  if (ids.length > 0) await rooms.update(Object.fromEntries(ids.map((id) => [id, null])));
  return Response.json({ deleted: ids.length });
}
