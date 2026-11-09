import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Profile } from "./api";
import { auth, googleProvider } from "./firebase";

type Session =
  | { state: "loading" }
  | { state: "signed_out" }
  | { state: "needs_profile"; user: User }
  | { state: "ready"; user: User; profile: Profile }
  | { state: "error"; user: User; error: unknown };

interface AuthValue {
  session: Session;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setProfile: (profile: Profile) => void;
  reload: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (active) setSession({ state: "signed_out" });
        return;
      }
      try {
        const profile = await api.me();
        if (active) setSession({ state: "ready", user, profile });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === "not_registered") {
          setSession({ state: "needs_profile", user });
        } else {
          setSession({ state: "error", user, error });
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  const signIn = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      // Some browsers and installed apps block popups. Use a redirect as a second try.
      const code = (error as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") throw error;
    }
  }, []);

  const value: AuthValue = {
    session,
    signIn,
    signOut: () => signOut(auth),
    setProfile: (profile) =>
      setSession((current) => ("user" in current ? { state: "ready", user: current.user, profile } : current)),
    reload: () => {
      setSession({ state: "loading" });
      setAttempt((n) => n + 1);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be inside AuthProvider");
  return value;
}

/** Profile of the signed-in person. Use only inside routes that need a profile. */
export function useProfile(): Profile {
  const { session } = useAuth();
  if (session.state !== "ready") throw new Error("No profile in this route");
  return session.profile;
}

export function canReview(profile: Profile): boolean {
  return profile.role === "admin" || profile.trust_level !== "regular";
}
