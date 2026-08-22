"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider.tsx";

export default function UserMenu() {
  const { user, status, login, logout } = useAuth();
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setLoggingIn(true);
    setError("");
    try {
      await login();
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
      await logout();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "로그아웃에 실패했습니다.";
      setError(message);
    } finally {
      setLoggingOut(false);
    }
  }

  if (status === "loading") {
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
