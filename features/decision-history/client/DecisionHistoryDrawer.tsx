"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionHistoryResponse } from "../shared/contract.ts";
import type { DecisionHistoryStatus } from "./useDecisionHistory.ts";

type Props = {
  open: boolean;
  decisions: DecisionHistoryResponse[];
  status: DecisionHistoryStatus;
  error: string | null;
  mutationError: string | null;
  deletingId: string | null;
  deletingAll: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDelete: (id: string) => Promise<boolean>;
  onDeleteAll: () => Promise<boolean>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

type CardProps = {
  decision: DecisionHistoryResponse;
  confirming: boolean;
  deleting: boolean;
  mutationActive: boolean;
  onBeginDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function sourceLabel(decision: DecisionHistoryResponse) {
  return decision.source.type === "menu-set"
    ? decision.source.menuSetName
    : "임시 메뉴";
}

function DecisionCard({
  decision,
  confirming,
  deleting,
  mutationActive,
  onBeginDelete,
  onCancelDelete,
  onConfirmDelete,
}: CardProps) {
  return (
    <li className="decision-history-card">
      <div className="decision-history-card-title">
        <span aria-hidden="true">{decision.selected.emoji}</span>
        <strong>{decision.selected.name}</strong>
      </div>
      <p>{sourceLabel(decision)}</p>
      <p className="decision-history-candidates">
        후보:{" "}
        {decision.candidates
          .map((item) => `${item.emoji} ${item.name}`)
          .join(" · ")}
      </p>
      <div className="decision-history-card-footer">
        <time dateTime={new Date(decision.createdAt).toISOString()}>
          {dateFormatter.format(decision.createdAt)}
        </time>
        {confirming ? (
          <span className="decision-history-confirm">
            <span>삭제할까요?</span>
            <button
              type="button"
              disabled={mutationActive}
              onClick={onConfirmDelete}
            >
              {deleting ? "삭제 중..." : "삭제"}
            </button>
            <button
              type="button"
              disabled={mutationActive}
              onClick={onCancelDelete}
            >
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={mutationActive}
            onClick={onBeginDelete}
          >
            삭제
          </button>
        )}
      </div>
    </li>
  );
}

function OpenDecisionHistoryDrawer(props: Props) {
  const { onClose, triggerRef } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const mutationActive = props.deletingAll || props.deletingId !== null;

  const close = useCallback(() => {
    setConfirmingId(null);
    setConfirmAll(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!drawerRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [close, triggerRef]);

  return (
    <div className="decision-history-layer" role="presentation">
      <button
        className="decision-history-backdrop"
        type="button"
        tabIndex={-1}
        aria-label="결정 기록 배경 닫기"
        onClick={close}
      />
      <aside
        ref={drawerRef}
        className="decision-history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-history-title"
        id="decision-history-drawer"
      >
        <header>
          <div>
            <h2 id="decision-history-title">결정 기록</h2>
            <p>최근 {props.decisions.length}/10</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="결정 기록 닫기"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="decision-history-content">
          {props.status === "loading" && (
            <div
              className="decision-history-skeleton"
              aria-label="결정 기록 불러오는 중"
            >
              <i />
              <i />
              <i />
            </div>
          )}

          {props.status === "error" && (
            <div className="decision-history-message" role="alert">
              <p>{props.error ?? "결정 기록을 불러오지 못했습니다."}</p>
              <button type="button" onClick={props.onRetry}>
                다시 시도
              </button>
            </div>
          )}

          {props.status === "ready" && props.error && (
            <div className="decision-history-error" role="alert">
              {props.error}
              <button type="button" onClick={props.onRetry}>
                다시 시도
              </button>
            </div>
          )}

          {props.mutationError && (
            <div className="decision-history-error" role="alert">
              {props.mutationError}
            </div>
          )}

          {props.status === "ready" && props.decisions.length === 0 && (
            <div className="decision-history-message">
              <p>아직 저장된 결정이 없어요.</p>
            </div>
          )}

          {props.status === "ready" && props.decisions.length > 0 && (
            <>
              <div className="decision-history-clear">
                {confirmAll ? (
                  <>
                    <span>모든 기록을 삭제할까요?</span>
                    <button
                      type="button"
                      disabled={mutationActive}
                      onClick={() => {
                        void props
                          .onDeleteAll()
                          .then((ok) => ok && setConfirmAll(false));
                      }}
                    >
                      {props.deletingAll ? "삭제 중..." : "전체 삭제"}
                    </button>
                    <button
                      type="button"
                      disabled={mutationActive}
                      onClick={() => setConfirmAll(false)}
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={mutationActive}
                    onClick={() => {
                      setConfirmingId(null);
                      setConfirmAll(true);
                    }}
                  >
                    전체 삭제
                  </button>
                )}
              </div>
              <ul>
                {props.decisions.map((decision) => (
                  <DecisionCard
                    key={decision.id}
                    decision={decision}
                    confirming={confirmingId === decision.id}
                    deleting={props.deletingId === decision.id}
                    mutationActive={mutationActive}
                    onBeginDelete={() => {
                      setConfirmAll(false);
                      setConfirmingId(decision.id);
                    }}
                    onCancelDelete={() => setConfirmingId(null)}
                    onConfirmDelete={() => {
                      void props
                        .onDelete(decision.id)
                        .then((ok) => ok && setConfirmingId(null));
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function DecisionHistoryDrawer(props: Props) {
  return props.open ? <OpenDecisionHistoryDrawer {...props} /> : null;
}
