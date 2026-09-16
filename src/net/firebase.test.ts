import { describe, expect, test } from "vitest";
import { createFirebaseClient } from "./firebase";

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

describe("createFirebaseClient", () => {
  test("initializes an app, database, and auth handle", () => {
    const client = createFirebaseClient(dummyConfig, "firebase-test-shape");
    expect(client.app.name).toBe("firebase-test-shape");
    expect(client.db).toBeTruthy();
    expect(client.auth).toBeTruthy();
  });
});
