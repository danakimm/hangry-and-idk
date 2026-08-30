"use client";

import { createContext, useContext } from "react";
import type { User } from "../shared/contract.ts";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  menuSetsEnabled: boolean;
  decisionHistoryEnabled: boolean;
  interactiveLoginVersion: number;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  onLogoutCleanup: (callback: () => void) => () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
