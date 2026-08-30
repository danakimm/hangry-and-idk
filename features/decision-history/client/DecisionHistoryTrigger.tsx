"use client";

import type { RefObject } from "react";
import { useAuth } from "../../auth/client/AuthProvider.tsx";

type DecisionHistoryTriggerProps = {
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  open?: boolean;
};

export default function DecisionHistoryTrigger({
  onOpen,
  buttonRef,
  open = false,
}: DecisionHistoryTriggerProps) {
  const { decisionHistoryEnabled, status } = useAuth();
  const isDisabled = status !== "authenticated";

  if (!decisionHistoryEnabled) return null;

  return (
    <button
      type="button"
      className="decision-history-trigger"
      aria-label="결정 기록 열기"
      aria-controls="decision-history-drawer"
      aria-expanded={open}
      title={isDisabled ? "로그인 후 결정 기록을 볼 수 있습니다." : undefined}
      ref={buttonRef}
      disabled={isDisabled}
      onClick={() => {
        if (!isDisabled) onOpen();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 3.5h9l3 3V20.5H6z" />
        <path d="M15 3.5v4h3M9 12h6M9 16h6" />
      </svg>
      <span className="decision-history-trigger-label">결정 기록</span>
    </button>
  );
}
