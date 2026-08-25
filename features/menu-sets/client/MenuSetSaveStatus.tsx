"use client";

import type { SaveStatus } from "./hooks.ts";

type MenuSetSaveStatusProps = {
  status: SaveStatus;
  error: string | null;
  conflictName: string;
  onConflictNameChange: (name: string) => void;
  onReloadConflict: () => void;
  onSaveConflictAsNew: () => void;
  onClearError: () => void;
  onRetry?: () => void;
};

export default function MenuSetSaveStatus({
  status,
  error,
  conflictName,
  onConflictNameChange,
  onReloadConflict,
  onSaveConflictAsNew,
  onClearError,
  onRetry,
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
          {onRetry && (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      )}
      {status === "conflict" && (
        <div className="status-conflict">
          <span>다른 곳에서 메뉴판이 변경됐어요.</span>
          <button type="button" onClick={onReloadConflict}>
            서버 최신본 불러오기
          </button>
          <label htmlFor="conflict-menu-set-name">새 메뉴판 이름</label>
          <input
            id="conflict-menu-set-name"
            type="text"
            value={conflictName}
            onChange={(event) => onConflictNameChange(event.target.value)}
            maxLength={30}
            placeholder="예: 회사 점심 복사본"
          />
          <button
            type="button"
            onClick={onSaveConflictAsNew}
            disabled={!conflictName.trim()}
          >
            내 변경을 새 메뉴판으로 저장
          </button>
        </div>
      )}
      {error && (
        <div className="status-error">
          <span>{error}</span>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          )}
          <button type="button" onClick={onClearError}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
