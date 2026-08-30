"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "../shared/contract.ts";
import { fetchSession, fetchSessionStrict, loginWithGoogle, logoutSession } from "./api.ts";
import { createCleanupRegistry } from "./cleanup.ts";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "./context.ts";

export { AuthContext, useAuth } from "./context.ts";
export type { AuthContextValue, AuthStatus } from "./context.ts";

export function AuthProvider({
  children,
  menuSetsEnabled = false,
  decisionHistoryEnabled = false,
}: {
  children: ReactNode;
  menuSetsEnabled?: boolean;
  decisionHistoryEnabled?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [interactiveLoginVersion, setInteractiveLoginVersion] = useState(0);
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
    setInteractiveLoginVersion((prev) => prev + 1);
  }, [refreshSession]);

  const logout = useCallback(async () => {
    runCleanups();
    setStatus("loading");
    try {
      await logoutSession();
      setUser(null);
      setStatus("anonymous");
    } catch (error) {
      try {
        await refreshSession();
      } catch {
        setUser(null);
        setStatus("anonymous");
      }
      throw error;
    }
  }, [refreshSession, runCleanups]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      menuSetsEnabled,
      decisionHistoryEnabled,
      interactiveLoginVersion,
      login,
      logout,
      refreshSession,
      onLogoutCleanup,
    }),
    [
      user,
      status,
      menuSetsEnabled,
      decisionHistoryEnabled,
      interactiveLoginVersion,
      login,
      logout,
      refreshSession,
      onLogoutCleanup,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
