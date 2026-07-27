import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AppRole, AppUserProfile } from "./model";
import { isAdmin, isOperator, isViewer } from "./model";
import { isSupabaseConfigured, supabase } from "./supabase";

type AuthContextValue = {
  error: string | null;
  isAdmin: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  isOperator: boolean;
  isViewer: boolean;
  profile: AppUserProfile | null;
  role: AppRole | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id,email,full_name,avatar_url,role,status")
    .eq("id", userId)
    .eq("status", "active")
    .single();

  if (error) {
    throw error;
  }

  return data as AppUserProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setError(null);

    if (!nextSession) {
      setProfile(null);
      return;
    }

    const nextProfile = await loadProfile(nextSession.user.id);
    setProfile(nextProfile);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      if (!isSupabaseConfigured) {
        if (isMounted) {
          setIsLoading(false);
          setError("Supabase public environment variables are not configured.");
        }
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
        setIsLoading(false);
        return;
      }

      try {
        await refreshProfile(data.session);
      } catch (profileError) {
        setProfile(null);
        setError(profileError instanceof Error ? profileError.message : "Unable to load user profile.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void initSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void refreshProfile(nextSession).catch((profileError: unknown) => {
        setProfile(null);
        setError(profileError instanceof Error ? profileError.message : "Unable to load user profile.");
      });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      throw signInError;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      throw signOutError;
    }
  }, []);

  const role = profile?.role ?? null;

  const value = useMemo(
    () => ({
      error,
      isAdmin: isAdmin(role),
      isConfigured: isSupabaseConfigured,
      isLoading,
      isOperator: isOperator(role),
      isViewer: isViewer(role),
      profile,
      role,
      session,
      signIn,
      signOut
    }),
    [error, isLoading, profile, role, session, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return value;
}
