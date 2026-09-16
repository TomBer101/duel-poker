import { type FirebaseOptions, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type UserCredential,
} from "firebase/auth";
import { type Database, connectDatabaseEmulator, getDatabase } from "firebase/database";

export type FirebaseClient = {
  app: ReturnType<typeof initializeApp>;
  db: Database;
  auth: Auth;
};

/**
 * Initializes a Firebase app + Realtime Database + Auth handle. Takes an
 * explicit config (and optional app name) rather than reading a module-level
 * singleton, so tests can spin up isolated, emulator-pointed instances.
 */
export function createFirebaseClient(
  config: FirebaseOptions,
  appName?: string,
): FirebaseClient {
  const app = initializeApp(config, appName);
  return { app, db: getDatabase(app), auth: getAuth(app) };
}

/** Points a client's db/auth handles at local emulators instead of production. */
export function connectToEmulators(
  client: Pick<FirebaseClient, "db" | "auth">,
  host = "127.0.0.1",
): void {
  connectDatabaseEmulator(client.db, host, 9000);
  connectAuthEmulator(client.auth, `http://${host}:9099`, { disableWarnings: true });
}

/** Signs the current session in anonymously; called once on app load. */
export function signInAnonymous(auth: Auth): Promise<UserCredential> {
  return signInAnonymously(auth);
}
