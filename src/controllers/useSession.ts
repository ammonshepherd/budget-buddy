import { useEffect, useState } from "react";
import type { DataStore, UserSession } from "../models/dataStore";
import { messageOf } from "./errors";

export type SessionState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "signedOut" }
  | { status: "signedIn"; session: UserSession };

const fromSession = (session: UserSession | null): SessionState =>
  session ? { status: "signedIn", session } : { status: "signedOut" };

/** Who is signed in, kept up to date as they sign in and out. */
export function useSession(store: DataStore): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    store.getSession().then(
      (session) => active && setState(fromSession(session)),
      (error: unknown) => active && setState({ status: "error", error: messageOf(error) }),
    );
    try {
      const unsubscribe = store.onSessionChange((session) => setState(fromSession(session)));
      return () => {
        active = false;
        unsubscribe();
      };
    } catch {
      // getSession above reports the same configuration error.
      return () => {
        active = false;
      };
    }
  }, [store]);

  return state;
}
