import { createContext, useContext } from "react";
import type { FirebaseClient } from "../net/firebase";

export type FirebaseContextValue = {
  client: FirebaseClient;
  /** null until anonymous sign-in resolves. */
  uid: string | null;
};

export const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function useFirebaseClient(): FirebaseContextValue {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error("useFirebaseClient must be used within a FirebaseProvider");
  }
  return context;
}
