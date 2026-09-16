import { describe, expect, test } from "vitest";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

describe("signInAnonymous (against the auth emulator)", () => {
  test("signs in and returns a user with a uid", async () => {
    const client = createFirebaseClient(dummyConfig, "firebase-emulator-signin");
    connectToEmulators(client);

    const credential = await signInAnonymous(client.auth);

    expect(credential.user.uid).toEqual(expect.any(String));
    expect(credential.user.isAnonymous).toBe(true);
  });
});
