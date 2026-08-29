"use client";

import type { MenuSetResponse } from "../shared/contract.ts";

type MenuSetSelectorProps = {
  menuSets: MenuSetResponse[];
  currentId: string | null;
  isLoading: boolean;
  disabled: boolean;
  createDisabled: boolean;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
};

export default function MenuSetSelector({
  menuSets,
  currentId,
  isLoading,
  disabled,
  createDisabled,
  onSelect,
  onCreateNew,
}: MenuSetSelectorProps) {
  if (isLoading) {
    return <div className="menu-set-selector loading">메뉴판을 불러오는 중...</div>;
  }

  if (menuSets.length === 0) {
    return (
      <div className="menu-set-selector empty">
        <span>아직 저장한 메뉴판이 없어요.</span>
        <button type="button" onClick={onCreateNew} disabled={disabled || createDisabled}>
          새 메뉴판 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="menu-set-selector">
      <label htmlFor="menu-set-select" className="sr-only">
        메뉴판 선택
      </label>
      <select
        id="menu-set-select"
        value={currentId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
      >
        {currentId === null && (
          <option value="" disabled>
            임시 메뉴 사용 중
          </option>
        )}
        {menuSets.map((ms) => (
          <option key={ms.id} value={ms.id}>
            {ms.name}
            {ms.isDefault ? " (대표)" : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={onCreateNew} disabled={disabled || createDisabled}>
        <span aria-hidden="true">＋</span>
        새 메뉴판
      </button>
    </div>
  );
}
