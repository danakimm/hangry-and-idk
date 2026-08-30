"use client";

import { useAuth } from "../../auth/client/AuthProvider.tsx";

type DecisionHistoryTriggerProps = {
  /** Reserved for the decision-history drawer introduced in the next work unit. */
  onOpen?: () => void;
  /** Defaults to disabled until a drawer is connected. */
  disabled?: boolean;
};

export default function DecisionHistoryTrigger({
  onOpen,
  disabled = true,
}: DecisionHistoryTriggerProps) {
  const { decisionHistoryEnabled } = useAuth();
  const isDisabled = disabled || !onOpen;

  if (!decisionHistoryEnabled) return null;

  return (
    <button
      type="button"
      className="decision-history-trigger"
      aria-label="결정 기록 열기"
      disabled={isDisabled}
      onClick={() => {
        if (!isDisabled) onOpen();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 3.5h9l3 3V20.5H6z" />
        <path d="M15 3.5v4h3M9 12h6M9 16h6" />
      </svg>
    </button>
  );
}
