"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "../shared/contract.ts";
import { fetchSession, fetchSessionStrict, loginWithGoogle, logoutSession } from "./api.ts";
import { createCleanupRegistry } from "./cleanup.ts";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  onLogoutCleanup: (callback: () => void) => () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const registryRef = useRef(createCleanupRegistry());
  const initializedRef = useRef(false);

  const onLogoutCleanup = useCallback((callback: () => void) => {
    return registryRef.current.register(callback);
  }, []);

  const runCleanups = useCallback(() => {
    registryRef.current.runAll();
  }, []);

  const refreshSession = useCallback(async () => {
    const sessionUser = await fetchSessionStrict();
    setUser(sessionUser);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void fetchSession().then(
      (sessionUser) => {
        setUser(sessionUser);
        setStatus(sessionUser ? "authenticated" : "anonymous");
      },
      () => {
        setUser(null);
        setStatus("anonymous");
      },
    );
  }, []);

  const login = useCallback(async () => {
    await loginWithGoogle();
    await refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    await logoutSession();
    runCleanups();
    setUser(null);
    setStatus("anonymous");
  }, [runCleanups]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, refreshSession, onLogoutCleanup }),
    [user, status, login, logout, refreshSession, onLogoutCleanup],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
