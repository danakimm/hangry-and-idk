"use client";

import { FormEvent, useEffect, useRef } from "react";

type MenuSetCreateDialogProps = {
  name: string;
  nameMaxLength: number;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onCancel: () => void;
};

export default function MenuSetCreateDialog({
  name,
  nameMaxLength,
  disabled,
  onNameChange,
  onCreate,
  onCancel,
}: MenuSetCreateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || disabled) return;
    onCreate();
  };

  return (
    <dialog
      className="menu-set-create-dialog"
      ref={dialogRef}
      aria-labelledby="new-menu-set-title"
      aria-describedby="new-menu-set-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!disabled) onCancel();
      }}
    >
      <form onSubmit={handleSubmit}>
        <span className="dialog-eyebrow">NEW MENU LIST</span>
        <h2 id="new-menu-set-title">새 메뉴판 만들기</h2>
        <p id="new-menu-set-description">
          현재 화면에 보이는 메뉴를 그대로 담아 새 메뉴판을 만듭니다.
        </p>
        <label htmlFor="new-menu-set-name">메뉴판 이름</label>
        <input
          id="new-menu-set-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={nameMaxLength}
          placeholder="예: 회사 점심"
          disabled={disabled}
        />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={disabled}>
            취소
          </button>
          <button type="submit" disabled={!name.trim() || disabled}>
            현재 메뉴로 만들기
          </button>
        </div>
      </form>
    </dialog>
  );
}
