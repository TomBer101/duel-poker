import type { FirebaseOptions } from "firebase/app";

const REQUIRED_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

/**
 * Reads the VITE_FIREBASE_* env vars into a FirebaseOptions object. Takes the
 * env map as a parameter (defaulting to Vite's `import.meta.env`) rather than
 * reading it internally, so tests can supply their own values.
 */
export function getFirebaseConfig(
  env: Partial<Record<(typeof REQUIRED_KEYS)[number], string>> = import.meta
    .env as unknown as Partial<Record<(typeof REQUIRED_KEYS)[number], string>>,
): FirebaseOptions {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(`missing required env var: ${key}`);
    }
  }
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}
