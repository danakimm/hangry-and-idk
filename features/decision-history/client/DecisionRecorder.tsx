"use client";

import { useCallback } from "react";
import { useAuth } from "../../auth/client/context.ts";
import type { DecisionHistoryCreateApiClient } from "./api.ts";
import type { DecisionDraft } from "./decision-draft.ts";
import { useDecisionRecorder } from "./useDecisionRecorder.ts";

type Props = {
  draft: DecisionDraft | null;
  onSaved?: () => void;
  apiClient?: DecisionHistoryCreateApiClient;
};

export default function DecisionRecorder({ draft, onSaved, apiClient }: Props) {
  const recorder = useDecisionRecorder(draft, apiClient);
  const { decisionHistoryEnabled, status: authStatus } = useAuth();
  const save = useCallback(async () => {
    if (await recorder.save()) onSaved?.();
  }, [onSaved, recorder]);

  if (!decisionHistoryEnabled || authStatus === "loading") return null;
  if (!recorder.enabled) {
    return (
      <div className="decision-recorder">
        <small>로그인하면 결정을 기록할 수 있어요</small>
      </div>
    );
  }

  return (
    <div className="decision-recorder">
      <button
        type="button"
        onClick={() => void save()}
        disabled={recorder.status === "saving" || recorder.status === "saved"}
      >
        {recorder.status === "saving"
          ? "기록하는 중..."
          : recorder.status === "saved"
            ? "결정 기록 완료 ✓"
            : recorder.status === "error"
              ? "다시 기록하기"
              : "이 메뉴로 결정"}
      </button>
      {recorder.error && <small role="alert">{recorder.error}</small>}
    </div>
  );
}
