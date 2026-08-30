"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DECISION_HISTORY_LIMIT } from "../../decision-history/shared/constants.ts";

type LoginBenefitsInfoProps = {
  menuSetsEnabled: boolean;
  decisionHistoryEnabled: boolean;
};

export default function LoginBenefitsInfo({
  menuSetsEnabled,
  decisionHistoryEnabled,
}: LoginBenefitsInfoProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const benefits = [
    menuSetsEnabled ? "메뉴판 저장 및 불러오기" : null,
    decisionHistoryEnabled
      ? `최근 결정 기록 최대 ${DECISION_HISTORY_LIMIT}개 보관`
      : null,
  ].filter((benefit): benefit is string => benefit !== null);
  const hasBenefits = benefits.length > 0;

  useEffect(() => {
    if (!isOpen || !hasBenefits) return;

    function closeForOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    function closeForEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", closeForOutsideClick);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener("mousedown", closeForOutsideClick);
      document.removeEventListener("keydown", closeForEscape);
    };
  }, [hasBenefits, isOpen]);

  if (!hasBenefits) return null;

  return (
    <div className="login-benefits" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="login-benefits-trigger"
        aria-label="로그인 혜택 안내"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-describedby={isOpen ? popoverId : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {isOpen && (
        <div id={popoverId} className="login-benefits-popover" role="tooltip">
          <strong>로그인하면</strong>
          <ul>
            {benefits.map((benefit) => (
              <li key={benefit}>{benefit}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
