"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, getMe } from "./api";
import type { CurrentUser } from "./types";

// Replaces lib/mock/store.tsx's currentUser/isAuthenticated/login/logout with the real thing:
// currentUser is fetched from GET /me (the session itself lives in httpOnly cookies set by
// app/api/auth/* route handlers — see lib/server/session.ts — this context only holds the
// profile data pages/components read). middleware.ts already blocks an unauthenticated visitor
// from rendering a protected page at all; this context's `isLoading` covers the brief window
// where a page has rendered but GET /me hasn't resolved yet.
type AuthContextValue = {
  currentUser: CurrentUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setCurrentUser: (user: CurrentUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const user = await getMe();
      setCurrentUser(user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCurrentUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((user) => {
        if (!cancelled) setCurrentUser(user);
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 401) {
          setCurrentUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ currentUser, isLoading, refresh, setCurrentUser }),
    [currentUser, isLoading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
