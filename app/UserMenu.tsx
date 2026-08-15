"use client";

import { useEffect, useState } from "react";
import { logoutFirebase, signInWithGoogle } from "@/lib/firebase/client";

type User = {
  uid: string;
  email: string | null;
  name: string | null;
};

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const res = await fetch("/api/auth/session", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { user: User | null };
          setUser(data.user);
        }
      } catch {
        // session check failed — treat as logged out
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void checkSession();
    return () => { cancelled = true; };
  }, []);

  async function handleLogin() {
    setLoggingIn(true);
    setError("");
    try {
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

      const sessionRes = await fetch("/api/auth/session", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!sessionRes.ok) {
        throw new Error("로그인 세션을 확인하지 못했습니다.");
      }
      const data = (await sessionRes.json()) as { user: User | null };
      setUser(data.user);
    } catch (err: unknown) {
      if (isPopupClosedError(err)) {
        return;
      }
      const message =
        err instanceof Error ? err.message : "로그인에 실패했습니다.";
      setError(message);
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        throw new Error("로그아웃에 실패했습니다.");
      }
      setUser(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "로그아웃에 실패했습니다.";
      setError(message);
    } finally {
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <div className="user-menu user-menu-loading" />;
  }

  if (user) {
    return (
      <div className="user-menu">
        <span className="user-name">
          {user.name ?? user.email ?? "사용자"}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {loggingOut ? "로그아웃 중..." : "로그아웃"}
        </button>
        {error && <span className="user-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="user-menu">
      {error && <span className="user-error">{error}</span>}
      <button
        type="button"
        className="login-button"
        onClick={() => void handleLogin()}
        disabled={loggingIn}
      >
        {loggingIn ? "로그인 중..." : "Google 로그인"}
      </button>
    </div>
  );
}

function isPopupClosedError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "FirebaseError" &&
      (err as { code?: string }).code === "auth/popup-closed-by-user"
    );
  }
  return false;
}
