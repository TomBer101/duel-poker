import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FirebaseProvider } from "./FirebaseProvider";
import { useFirebaseClient } from "./firebaseContext";

const fakeAuth = { currentUser: null };
const fakeClient = { app: { name: "fake" }, db: {}, auth: fakeAuth };

vi.mock("../net/env", () => ({
  getFirebaseConfig: () => ({}),
}));
vi.mock("../net/firebase", () => ({
  createFirebaseClient: () => fakeClient,
  signInAnonymous: () => Promise.resolve({ user: { uid: "test-uid" } }),
}));

describe("useFirebaseClient", () => {
  test("throws when used outside a FirebaseProvider", () => {
    expect(() => renderHook(() => useFirebaseClient())).toThrow(
      /FirebaseProvider/,
    );
  });

  test("provides the client immediately and the uid once anonymous sign-in resolves", async () => {
    function Probe() {
      const { client, uid } = useFirebaseClient();
      return <span>{client === fakeClient ? `uid:${uid ?? "none"}` : "wrong client"}</span>;
    }

    render(
      <FirebaseProvider>
        <Probe />
      </FirebaseProvider>,
    );

    expect(screen.getByText("uid:none")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("uid:test-uid")).toBeInTheDocument();
    });
  });
});
