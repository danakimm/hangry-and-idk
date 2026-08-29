"use client";

import { useCallback } from "react";
import type { MenuSetResponse, MenuSetItemRequest } from "../shared/contract.ts";
import type { SaveStatus } from "./hooks.ts";
import { palette } from "../../roulette/shared/constants.ts";
import {
  MENU_SET_ITEMS_MIN,
  MENU_SET_ITEMS_MAX,
  MENU_SET_NAME_MAX_LENGTH,
  MENU_ITEM_NAME_MAX_LENGTH,
} from "../shared/constants.ts";

type MenuSetEditorProps = {
  menuSet: MenuSetResponse;
  draftName: string;
  draftItems: MenuSetItemRequest[];
  saveStatus: SaveStatus;
  isBusy: boolean;
  onDraftChange: (name: string, items: MenuSetItemRequest[]) => void;
  onSave: () => void;
  onReset: () => void;
};

export default function MenuSetEditor({
  menuSet,
  draftName,
  draftItems,
  saveStatus,
  isBusy,
  onDraftChange,
  onSave,
  onReset,
}: MenuSetEditorProps) {
  const disabled = isBusy || saveStatus === "conflict";

  const updateItem = useCallback(
    (index: number, field: "name" | "emoji" | "color", value: string) => {
      if (disabled) return;
      const nextItems = draftItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      );
      onDraftChange(draftName, nextItems);
    },
    [draftItems, draftName, onDraftChange, disabled],
  );

  const addItem = useCallback(() => {
    if (disabled || draftItems.length >= MENU_SET_ITEMS_MAX) return;
    onDraftChange(draftName, [
      ...draftItems,
      {
        id: null,
        name: "",
        emoji: "🍽️",
        color: palette[draftItems.length % palette.length],
      },
    ]);
  }, [draftItems, draftName, onDraftChange, disabled]);

  const removeItem = useCallback((index: number) => {
    if (disabled || draftItems.length <= MENU_SET_ITEMS_MIN) return;
    onDraftChange(
      draftName,
      draftItems.filter((_, itemIndex) => itemIndex !== index),
    );
  }, [draftItems, draftName, onDraftChange, disabled]);

  const saveButtonText = saveStatus === "saving" ? "저장 중..." : saveStatus === "offline" ? "다시 저장" : "저장";
  const canSave = saveStatus === "dirty" || saveStatus === "offline";

  return (
    <div className="menu-set-editor" data-menu-set-id={menuSet.id}>
      <div className="menu-set-name-field">
        <label htmlFor="menu-set-name">메뉴판 이름</label>
        <input
          id="menu-set-name"
          type="text"
          value={draftName}
          onChange={(event) => !disabled && onDraftChange(event.target.value, draftItems)}
          maxLength={MENU_SET_NAME_MAX_LENGTH}
          disabled={disabled}
        />
      </div>
      <div className="menu-set-items">
        {draftItems.map((item, index) => (
          <div key={item.id ?? `new-${index}`} className="menu-set-item">
            <input
              type="text"
              value={item.name}
              onChange={(event) => updateItem(index, "name", event.target.value)}
              maxLength={MENU_ITEM_NAME_MAX_LENGTH}
              placeholder="메뉴 이름"
              disabled={disabled}
            />
            <input
              type="text"
              value={item.emoji}
              onChange={(event) => updateItem(index, "emoji", event.target.value)}
              maxLength={8}
              placeholder="이모지"
              disabled={disabled}
            />
            <input
              type="color"
              value={item.color}
              onChange={(event) => updateItem(index, "color", event.target.value)}
              disabled={disabled}
            />
            {draftItems.length > MENU_SET_ITEMS_MIN && (
              <button type="button" onClick={() => removeItem(index)} disabled={disabled}>
                삭제
              </button>
            )}
          </div>
        ))}
      </div>
      {draftItems.length < MENU_SET_ITEMS_MAX && (
        <button type="button" onClick={addItem} disabled={disabled}>
          메뉴 추가
        </button>
      )}
      <div className="menu-set-actions">
        <button type="button" onClick={onSave} disabled={disabled || !canSave}>
          {saveButtonText}
        </button>
        <button type="button" onClick={onReset} disabled={disabled}>
          저장본으로 되돌리기
        </button>
      </div>
    </div>
  );
}
