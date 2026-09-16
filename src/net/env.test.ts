import { describe, expect, test } from "vitest";
import { getFirebaseConfig } from "./env";

const fakeEnv = {
  VITE_FIREBASE_API_KEY: "key",
  VITE_FIREBASE_AUTH_DOMAIN: "app.firebaseapp.com",
  VITE_FIREBASE_DATABASE_URL: "https://app-default-rtdb.firebaseio.com",
  VITE_FIREBASE_PROJECT_ID: "app",
  VITE_FIREBASE_STORAGE_BUCKET: "app.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
};

describe("getFirebaseConfig", () => {
  test("maps VITE_FIREBASE_* env vars onto a FirebaseOptions object", () => {
    expect(getFirebaseConfig(fakeEnv)).toEqual({
      apiKey: "key",
      authDomain: "app.firebaseapp.com",
      databaseURL: "https://app-default-rtdb.firebaseio.com",
      projectId: "app",
      storageBucket: "app.appspot.com",
      messagingSenderId: "123",
      appId: "1:123:web:abc",
    });
  });

  test("throws with a clear message when a required var is missing", () => {
    const incomplete = { ...fakeEnv, VITE_FIREBASE_API_KEY: undefined };
    expect(() => getFirebaseConfig(incomplete)).toThrow(/VITE_FIREBASE_API_KEY/);
  });
});
