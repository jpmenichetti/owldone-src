import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

const RETURN_TO_KEY = "owldone_post_auth_return_to";

const stashReturnTo = () => {
  const target = window.location.pathname + window.location.search + window.location.hash;
  // Only stash if there's actually something to restore beyond "/"
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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let autoLoginAttempted = false;

    const tryAutoLogin = async () => {
      if (autoLoginAttempted) return;
      autoLoginAttempted = true;
      const wasSignedIn = localStorage.getItem("owldone_was_signed_in");
      if (wasSignedIn === "true") {
        stashReturnTo();
        await lovable.auth.signInWithOAuth("google", {
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
        localStorage.setItem("owldone_was_signed_in", "true");
        consumeReturnTo();
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        localStorage.setItem("owldone_was_signed_in", "true");
        consumeReturnTo();
        setLoading(false);
      } else {
        tryAutoLogin();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    stashReturnTo();
    await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
  };

  const signOut = async () => {
    localStorage.removeItem("owldone_was_signed_in");
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
