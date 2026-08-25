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
  onDraftChange: (name: string, items: MenuSetItemRequest[]) => void;
  onSave: () => void;
};

export default function MenuSetEditor({
  menuSet,
  draftName,
  draftItems,
  saveStatus,
  onDraftChange,
  onSave,
}: MenuSetEditorProps) {
  const updateItem = useCallback(
    (index: number, field: "name" | "emoji" | "color", value: string) => {
      const nextItems = draftItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      );
      onDraftChange(draftName, nextItems);
    },
    [draftItems, draftName, onDraftChange],
  );

  const addItem = useCallback(() => {
    if (draftItems.length >= MENU_SET_ITEMS_MAX) return;
    onDraftChange(draftName, [
      ...draftItems,
      {
        id: null,
        name: "",
        emoji: "🍽️",
        color: palette[draftItems.length % palette.length],
      },
    ]);
  }, [draftItems, draftName, onDraftChange]);

  const removeItem = useCallback((index: number) => {
    if (draftItems.length <= MENU_SET_ITEMS_MIN) return;
    onDraftChange(
      draftName,
      draftItems.filter((_, itemIndex) => itemIndex !== index),
    );
  }, [draftItems, draftName, onDraftChange]);

  return (
    <div className="menu-set-editor" data-menu-set-id={menuSet.id}>
      <div className="menu-set-name-field">
        <label htmlFor="menu-set-name">메뉴판 이름</label>
        <input
          id="menu-set-name"
          type="text"
          value={draftName}
          onChange={(event) => onDraftChange(event.target.value, draftItems)}
          maxLength={MENU_SET_NAME_MAX_LENGTH}
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
            />
            <input
              type="text"
              value={item.emoji}
              onChange={(event) => updateItem(index, "emoji", event.target.value)}
              maxLength={8}
              placeholder="이모지"
            />
            <input
              type="color"
              value={item.color}
              onChange={(event) => updateItem(index, "color", event.target.value)}
            />
            {draftItems.length > MENU_SET_ITEMS_MIN && (
              <button type="button" onClick={() => removeItem(index)}>
                삭제
              </button>
            )}
          </div>
        ))}
      </div>
      {draftItems.length < MENU_SET_ITEMS_MAX && (
        <button type="button" onClick={addItem}>
          메뉴 추가
        </button>
      )}
      <div className="menu-set-actions">
        <button
          type="button"
          onClick={onSave}
          disabled={saveStatus === "saving"}
        >
          {saveStatus === "saving" ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
