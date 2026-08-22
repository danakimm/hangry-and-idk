"use client";

import type { User, AuthSessionResponse } from "../shared/contract.ts";
import { logoutFirebase, signInWithGoogle } from "./firebase.ts";

export async function fetchSession(): Promise<User | null> {
  const res = await fetch("/api/auth/session", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as AuthSessionResponse;
  return data.user;
}

export async function fetchSessionStrict(): Promise<User> {
  const res = await fetch("/api/auth/session", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error("로그인 세션을 확인하지 못했습니다.");
  }
  const data = (await res.json()) as AuthSessionResponse;
  if (!data.user) {
    throw new Error("로그인 세션을 확인하지 못했습니다.");
  }
  return data.user;
}

export async function loginWithGoogle(): Promise<void> {
  const credential = await signInWithGoogle();
  try {
    const idToken = await credential.user.getIdToken();
    const res = await fetch("/api/auth/firebase/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(
        body?.error?.message ?? "세션 생성에 실패했습니다.",
      );
    }
  } finally {
    await logoutFirebase();
  }
}

export async function logoutSession(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) {
    throw new Error("로그아웃에 실패했습니다.");
  }
}
