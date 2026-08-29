"use client";

import type { SaveStatus } from "./hooks.ts";

type MenuSetSaveStatusProps = {
  status: SaveStatus;
  error: string | null;
  isBusy: boolean;
  onReloadConflict: () => void;
  onClearError: () => void;
};

export default function MenuSetSaveStatus({
  status,
  error,
  isBusy,
  onReloadConflict,
  onClearError,
}: MenuSetSaveStatusProps) {
  if (status === "idle" && !error) return null;

  return (
    <div className="menu-set-save-status" role="status" aria-live="polite">
      {status === "dirty" && <span className="status-dirty">변경 사항 있음</span>}
      {status === "saving" && <span className="status-saving">저장 중...</span>}
      {status === "saved" && <span className="status-saved">저장됨</span>}
      {status === "offline" && (
        <div className="status-offline">
          <span>오프라인 - 변경 사항이 유지됩니다</span>
        </div>
      )}
      {status === "conflict" && (
        <div className="status-conflict">
          <span>다른 곳에서 변경됐어요. 최신본을 불러오면 현재 편집 내용은 사라집니다.</span>
          <button type="button" onClick={onReloadConflict} disabled={isBusy}>
            서버 최신본 불러오기
          </button>
        </div>
      )}
      {error && (
        <div className="status-error">
          <span>{error}</span>
          <button type="button" onClick={onClearError}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
