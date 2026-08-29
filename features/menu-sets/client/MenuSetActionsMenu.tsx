"use client";

import { useEffect, useRef } from "react";

type MenuSetActionsMenuProps = {
  isDefault: boolean;
  disabled: boolean;
  onSetDefault: () => void;
  onSwitchToTemporary: () => void;
  onArchive: () => void;
};

export default function MenuSetActionsMenu({
  isDefault,
  disabled,
  onSetDefault,
  onSwitchToTemporary,
  onArchive,
}: MenuSetActionsMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (disabled) detailsRef.current?.removeAttribute("open");
  }, [disabled]);

  const runAction = (action: () => void) => {
    detailsRef.current?.removeAttribute("open");
    action();
  };

  return (
    <details className="menu-set-actions-menu" ref={detailsRef}>
      <summary
        aria-label="현재 메뉴판 작업"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        ···
      </summary>
      <div className="menu-set-actions-popover">
        <button
          type="button"
          onClick={() => runAction(onSetDefault)}
          disabled={disabled || isDefault}
        >
          {isDefault ? "대표 메뉴판으로 사용 중" : "대표 메뉴판으로 설정"}
        </button>
        <button
          type="button"
          onClick={() => runAction(onSwitchToTemporary)}
          disabled={disabled}
        >
          임시 메뉴로 전환
        </button>
        <button
          type="button"
          className="danger-action"
          onClick={() => runAction(onArchive)}
          disabled={disabled}
        >
          메뉴판 삭제
        </button>
      </div>
    </details>
  );
}
