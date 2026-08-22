"use client";

import { FormEvent, useState } from "react";
import type { MenuItem } from "../shared/contract.ts";
import {
  customMenuEmojis,
  defaultMenuEmoji,
  MAX_MENUS,
} from "../shared/constants.ts";
import {
  applyResetTransition,
  applySubmitTransition,
} from "./menu-editor-state.ts";

type MenuEditorProps = {
  menus: MenuItem[];
  isSpinning: boolean;
  resetKey: number;
  onAdd: (name: string, emoji: string) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
};

export default function MenuEditor({
  menus,
  isSpinning,
  resetKey,
  onAdd,
  onRemove,
  onReset,
}: MenuEditorProps) {
  const [newMenu, setNewMenu] = useState("");
  const [newMenuEmoji, setNewMenuEmoji] = useState(defaultMenuEmoji);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    const next = applyResetTransition({
      inputText: newMenu,
      emoji: newMenuEmoji,
      isPickerOpen: isEmojiPickerOpen,
    });
    setNewMenuEmoji(next.emoji);
    setIsEmojiPickerOpen(next.isPickerOpen);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newMenu.trim();
    if (!name || menus.length >= MAX_MENUS) return;

    onAdd(name, newMenuEmoji);
    const next = applySubmitTransition();
    setNewMenu(next.inputText);
    setNewMenuEmoji(next.emoji);
    setIsEmojiPickerOpen(next.isPickerOpen);
  };

  return (
    <aside className="menu-panel">
      <div className="panel-heading">
        <div>
          <span>MY MENU LIST</span>
          <h2>오늘의 후보</h2>
        </div>
        <button type="button" className="text-button" onClick={onReset} disabled={isSpinning}>
          처음대로
        </button>
      </div>

      <ul className="menu-list" aria-label="룰렛 메뉴 목록">
        {menus.map((menu, index) => (
          <li key={menu.id}>
            <span className="menu-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="menu-emoji" aria-hidden="true">{menu.emoji}</span>
            <strong>{menu.name}</strong>
            <button
              type="button"
              onClick={() => onRemove(menu.id)}
              disabled={menus.length <= 2 || isSpinning}
              aria-label={`${menu.name} 삭제`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form className="menu-form" onSubmit={handleSubmit}>
        <label htmlFor="menu-input">먹고 싶은 메뉴 직접 추가</label>
        <div className="menu-input-row">
          <button
            type="button"
            className="emoji-trigger"
            onClick={() => setIsEmojiPickerOpen((current) => !current)}
            disabled={menus.length >= MAX_MENUS || isSpinning}
            aria-haspopup="listbox"
            aria-expanded={isEmojiPickerOpen}
            aria-label={`메뉴 아이콘 ${newMenuEmoji}, 변경`}
          >
            {newMenuEmoji}
          </button>
          <input
            id="menu-input"
            value={newMenu}
            onChange={(event) => setNewMenu(event.target.value)}
            placeholder="예: 쌀국수"
            maxLength={12}
            disabled={menus.length >= MAX_MENUS || isSpinning}
          />
          <button
            type="submit"
            className="add-menu-button"
            disabled={!newMenu.trim() || menus.length >= MAX_MENUS || isSpinning}
            aria-label="메뉴 추가"
          >
            +
          </button>
        </div>
        {isEmojiPickerOpen && (
          <div className="emoji-picker" role="listbox" aria-label="메뉴 아이콘 선택">
            {customMenuEmojis.map((emoji) => (
              <button
                type="button"
                role="option"
                aria-selected={newMenuEmoji === emoji}
                aria-label={`${emoji} 아이콘 선택`}
                key={emoji}
                onClick={() => {
                  setNewMenuEmoji(emoji);
                  setIsEmojiPickerOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </form>
    </aside>
  );
}
