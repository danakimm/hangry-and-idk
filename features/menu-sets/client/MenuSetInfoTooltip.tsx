"use client";

import { useEffect, useRef } from "react";

export default function MenuSetInfoTooltip() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) {
        detailsRef.current?.removeAttribute("open");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;

      detailsRef.current.removeAttribute("open");
      detailsRef.current.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <details className="menu-set-info-tooltip" ref={detailsRef}>
      <summary aria-label="메뉴판 사용 안내">
        <span aria-hidden="true">i</span>
      </summary>
      <div className="menu-set-info-popover">
        <strong>메뉴판 사용 안내</strong>
        <p>메뉴판을 고르면 그 안의 메뉴들이 룰렛 후보가 됩니다.</p>
        <p>편집한 내용은 저장 버튼을 눌러야 저장돼요.</p>
        <p>‘대표’는 자주 쓰는 메뉴판을 알아보기 위한 표시예요.</p>
      </div>
    </details>
  );
}
