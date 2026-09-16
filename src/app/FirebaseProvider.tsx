import { useEffect, useState, type ReactNode } from "react";
import { createFirebaseClient, signInAnonymous } from "../net/firebase";
import { getFirebaseConfig } from "../net/env";
import { FirebaseContext } from "./firebaseContext";

/** Creates a single Firebase client for the app and signs it in anonymously. */
export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createFirebaseClient(getFirebaseConfig()));
  const [uid, setUid] = useState<string | null>(client.auth.currentUser?.uid ?? null);

  useEffect(() => {
    if (uid) return;
    let cancelled = false;
    signInAnonymous(client.auth).then((credential) => {
      if (!cancelled) setUid(credential.user.uid);
    });
    return () => {
      cancelled = true;
    };
  }, [client, uid]);

  return (
    <FirebaseContext.Provider value={{ client, uid }}>{children}</FirebaseContext.Provider>
  );
}
