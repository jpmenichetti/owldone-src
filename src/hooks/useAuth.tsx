import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type OAuthProvider = "google" | "apple";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  signOut: async () => {},
});

const RETURN_TO_KEY = "owldone_post_auth_return_to";
const SIGNED_IN_KEY = "owldone_was_signed_in";
const LAST_PROVIDER_KEY = "owldone_last_provider";

const stashReturnTo = () => {
  const target = window.location.pathname + window.location.search + window.location.hash;
  if (target && target !== "/") {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, target);
    } catch {
      // ignore storage errors
    }
  }
};

const consumeReturnTo = () => {
  try {
    const target = sessionStorage.getItem(RETURN_TO_KEY);
    if (!target) return;
    sessionStorage.removeItem(RETURN_TO_KEY);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target !== current) {
      window.history.replaceState({}, "", target);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }
  } catch {
    // ignore storage errors
  }
};

const readLastProvider = (): OAuthProvider => {
  try {
    const stored = localStorage.getItem(LAST_PROVIDER_KEY);
    if (stored === "apple" || stored === "google") return stored;
  } catch {
    // ignore
  }
  return "google";
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The iOS native app uses /auth/ios-callback as a transient bridge page.
    // It manages its own OAuth and hands the resulting session off to the
    // app via a custom URL scheme. The shared AuthProvider must stay out of
    // the way: no auto re-login (which would clobber redirect_uri), no
    // return-to handling, no localStorage flag writes.
    if (window.location.pathname === "/auth/ios-callback") {
      setLoading(false);
      return;
    }

    let autoLoginAttempted = false;

    const tryAutoLogin = async () => {
      if (autoLoginAttempted) return;
      autoLoginAttempted = true;
      const wasSignedIn = localStorage.getItem(SIGNED_IN_KEY);
      if (wasSignedIn === "true") {
        stashReturnTo();
        await lovable.auth.signInWithOAuth(readLastProvider(), {
          redirect_uri: window.location.origin,
        });
      } else {
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        localStorage.setItem(SIGNED_IN_KEY, "true");
        consumeReturnTo();
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        localStorage.setItem(SIGNED_IN_KEY, "true");
        consumeReturnTo();
        setLoading(false);
      } else {
        tryAutoLogin();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWith = async (provider: OAuthProvider) => {
    stashReturnTo();
    try {
      localStorage.setItem(LAST_PROVIDER_KEY, provider);
    } catch {
      // ignore
    }
    await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
  };

  const signInWithGoogle = () => signInWith("google");
  const signInWithApple = () => signInWith("apple");

  const signOut = async () => {
    localStorage.removeItem(SIGNED_IN_KEY);
    localStorage.removeItem(LAST_PROVIDER_KEY);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signInWithGoogle, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
