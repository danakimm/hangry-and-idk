"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider.tsx";
import LoginBenefitsInfo from "./LoginBenefitsInfo.tsx";

export default function UserMenu() {
  const { user, status, login, logout, menuSetsEnabled, decisionHistoryEnabled } =
    useAuth();
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
        <div className="user-menu-actions">
          <span className="user-name" title={user.name ?? user.email ?? "사용자"}>
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
        </div>
        {error && <span className="user-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="user-menu">
      <div className="user-menu-actions">
        <button
          type="button"
          className="login-button"
          aria-label="Google 로그인"
          onClick={() => void handleLogin()}
          disabled={loggingIn}
        >
          {loggingIn ? (
            "로그인 중..."
          ) : (
            <>
              <span className="login-button-full">Google 로그인</span>
              <span className="login-button-compact" aria-hidden="true">
                로그인
              </span>
            </>
          )}
        </button>
        <LoginBenefitsInfo
          key={`${menuSetsEnabled}-${decisionHistoryEnabled}`}
          menuSetsEnabled={menuSetsEnabled}
          decisionHistoryEnabled={decisionHistoryEnabled}
        />
      </div>
      {error && <span className="user-error">{error}</span>}
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
