"use client";

import { FormEvent, ReactNode, useState } from "react";
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
  disabled: boolean;
  resetKey: number;
  toolbar?: ReactNode;
  feedback?: ReactNode;
  onAdd: (name: string, emoji: string) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  savedMenu?: {
    id: string;
    name: string;
    isDefault: boolean;
    isEditing: boolean;
    nameMaxLength: number;
    saveLabel: string;
    canSave: boolean;
    onNameChange: (name: string) => void;
    onItemChange: (
      index: number,
      field: "name" | "emoji" | "color",
      value: string,
    ) => void;
    onBeginEdit: () => void;
    onCancelEdit: () => void;
    onSave: () => void;
  };
};

type EmojiPickerProps = {
  id: string;
  value: string;
  disabled: boolean;
  className?: string;
  onSelect: (emoji: string) => void;
};

function EmojiPicker({
  id,
  value,
  disabled,
  className = "",
  onSelect,
}: EmojiPickerProps) {
  return (
    <div
      className={`emoji-picker${className ? ` ${className}` : ""}`}
      id={id}
      role="group"
      aria-label="메뉴 아이콘 선택"
    >
      {customMenuEmojis.map((emoji) => (
        <button
          type="button"
          aria-pressed={value === emoji}
          aria-label={`${emoji} 아이콘 선택`}
          key={emoji}
          onClick={() => onSelect(emoji)}
          disabled={disabled}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export default function MenuEditor({
  menus,
  disabled,
  resetKey,
  toolbar,
  feedback,
  onAdd,
  onRemove,
  onReset,
  savedMenu,
}: MenuEditorProps) {
  const [newMenu, setNewMenu] = useState("");
  const [newMenuEmoji, setNewMenuEmoji] = useState(defaultMenuEmoji);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [editingEmojiIndex, setEditingEmojiIndex] = useState<number | null>(null);
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
    setEditingEmojiIndex(null);
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
    <aside
      className={`menu-panel${savedMenu ? " saved-menu-panel" : ""}`}
      data-menu-set-id={savedMenu?.id}
      data-menu-source={savedMenu ? "menu-set" : "anonymous"}
    >
      {toolbar && <div className="menu-panel-toolbar">{toolbar}</div>}
      <div className="panel-heading">
        <div>
          <span>MY MENU LIST</span>
          {savedMenu ? (
            savedMenu.isEditing ? (
              <label className="menu-board-name-field">
                <span className="sr-only">메뉴판 이름</span>
                <input
                  className="menu-board-name-input"
                  type="text"
                  value={savedMenu.name}
                  onChange={(event) => savedMenu.onNameChange(event.target.value)}
                  maxLength={savedMenu.nameMaxLength}
                  disabled={disabled}
                />
              </label>
            ) : (
              <div className="menu-board-title-row">
                <h2>{savedMenu.name}</h2>
                {savedMenu.isDefault && <span className="default-menu-badge">대표</span>}
              </div>
            )
          ) : (
            <h2>오늘의 후보</h2>
          )}
        </div>
        {savedMenu ? (
          !savedMenu.isEditing && (
            <button
              type="button"
              className="edit-menu-button"
              onClick={() => {
                setEditingEmojiIndex(null);
                savedMenu.onBeginEdit();
              }}
              disabled={disabled}
            >
              편집
            </button>
          )
        ) : (
          <button type="button" className="text-button" onClick={onReset} disabled={disabled}>
            처음대로
          </button>
        )}
      </div>

      <ul
        className={`menu-list${savedMenu?.isEditing ? " editable-menu-list" : ""}${savedMenu && !savedMenu.isEditing ? " saved-menu-list" : ""}`}
        aria-label="룰렛 메뉴 목록"
      >
        {menus.map((menu, index) => (
          <li key={menu.id}>
            <span className="menu-number">{String(index + 1).padStart(2, "0")}</span>
            {savedMenu?.isEditing ? (
              <>
                <button
                  className="menu-item-emoji-trigger"
                  type="button"
                  onClick={() => {
                    setIsEmojiPickerOpen(false);
                    setEditingEmojiIndex((current) => current === index ? null : index);
                  }}
                  aria-expanded={editingEmojiIndex === index}
                  aria-controls={`menu-item-emoji-picker-${index}`}
                  aria-label={`${String(index + 1)}번째 메뉴 아이콘 ${menu.emoji}, 변경`}
                  disabled={disabled}
                >
                  {menu.emoji}
                </button>
                {editingEmojiIndex === index && (
                  <EmojiPicker
                    id={`menu-item-emoji-picker-${index}`}
                    value={menu.emoji}
                    disabled={disabled}
                    className="menu-item-emoji-picker"
                    onSelect={(emoji) => {
                      savedMenu.onItemChange(index, "emoji", emoji);
                      setEditingEmojiIndex(null);
                    }}
                  />
                )}
                <input
                  className="menu-item-name-input"
                  type="text"
                  value={menu.name}
                  onChange={(event) => savedMenu.onItemChange(index, "name", event.target.value)}
                  maxLength={12}
                  aria-label={`${String(index + 1)}번째 메뉴 이름`}
                  disabled={disabled}
                />
                <input
                  className="menu-item-color-input"
                  type="color"
                  value={menu.color}
                  onChange={(event) => savedMenu.onItemChange(index, "color", event.target.value)}
                  aria-label={`${String(index + 1)}번째 메뉴 색상`}
                  disabled={disabled}
                />
              </>
            ) : (
              <>
                <span className="menu-emoji" aria-hidden="true">{menu.emoji}</span>
                <strong>{menu.name}</strong>
              </>
            )}
            {(!savedMenu || savedMenu.isEditing) && (
              <button
                type="button"
                onClick={() => {
                  setEditingEmojiIndex(null);
                  onRemove(menu.id);
                }}
                disabled={menus.length <= 2 || disabled}
                aria-label={`${menu.name} 삭제`}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {(!savedMenu || savedMenu.isEditing) && <form className="menu-form" onSubmit={handleSubmit}>
        <label htmlFor="menu-input">먹고 싶은 메뉴 직접 추가</label>
        <div className="menu-input-row">
          <button
            type="button"
            className="emoji-trigger"
            onClick={() => {
              setEditingEmojiIndex(null);
              setIsEmojiPickerOpen((current) => !current);
            }}
            disabled={menus.length >= MAX_MENUS || disabled}
            aria-expanded={isEmojiPickerOpen}
            aria-controls="menu-emoji-picker"
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
            disabled={menus.length >= MAX_MENUS || disabled}
          />
          <button
            type="submit"
            className="add-menu-button"
            disabled={!newMenu.trim() || menus.length >= MAX_MENUS || disabled}
            aria-label="메뉴 추가"
          >
            +
          </button>
        </div>
        {isEmojiPickerOpen && (
          <EmojiPicker
            id="menu-emoji-picker"
            value={newMenuEmoji}
            disabled={menus.length >= MAX_MENUS || disabled}
            onSelect={(emoji) => {
              setNewMenuEmoji(emoji);
              setIsEmojiPickerOpen(false);
            }}
          />
        )}
      </form>}

      {feedback && <div className="menu-panel-feedback">{feedback}</div>}

      {savedMenu?.isEditing && (
        <div className="active-menu-save-actions">
          <button
            type="button"
            className="cancel-menu-edit-button"
            onClick={() => {
              setEditingEmojiIndex(null);
              savedMenu.onCancelEdit();
            }}
            disabled={disabled}
          >
            편집 취소
          </button>
          <button
            type="button"
            className="save-menu-button"
            onClick={() => {
              setEditingEmojiIndex(null);
              savedMenu.onSave();
            }}
            disabled={disabled || !savedMenu.canSave}
          >
            {savedMenu.saveLabel}
          </button>
        </div>
      )}
    </aside>
  );
}
