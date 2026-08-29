"use client";

import { useCallback, useState } from "react";
import type { MenuItem } from "../shared/contract.ts";
import { palette } from "../shared/constants.ts";

type ReplaceableMenuItem = Omit<MenuItem, "id"> & { id: string | null };

export const initialMenus: MenuItem[] = [
  { id: "default-1", name: "한식", emoji: "🍚", color: palette[0] },
  { id: "default-2", name: "중식", emoji: "🥟", color: palette[1] },
  { id: "default-3", name: "일식", emoji: "🍣", color: palette[2] },
  { id: "default-4", name: "양식", emoji: "🍝", color: palette[3] },
  { id: "default-5", name: "분식", emoji: "🌶️", color: palette[4] },
  { id: "default-6", name: "치킨", emoji: "🍗", color: palette[5] },
  { id: "default-7", name: "버거", emoji: "🍔", color: palette[6] },
  { id: "default-8", name: "샐러드", emoji: "🥗", color: palette[7] },
];

export function useMenuState() {
  const [menus, setMenus] = useState<MenuItem[]>(initialMenus);
  const [resetKey, setResetKey] = useState(0);

  const addMenu = useCallback(
    (name: string, emoji: string) => {
      setMenus((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name,
          emoji,
          color: palette[current.length % palette.length],
        },
      ]);
    },
    [],
  );

  const removeMenu = useCallback((id: string) => {
    setMenus((current) => current.filter((menu) => menu.id !== id));
  }, []);

  const resetMenus = useCallback(() => {
    setMenus(initialMenus.map((menu) => ({ ...menu })));
    setResetKey((k) => k + 1);
  }, []);

  const replaceMenus = useCallback((items: ReplaceableMenuItem[]) => {
    setMenus(items.map((item) => ({
      ...item,
      id: item.id ?? crypto.randomUUID(),
    })));
    setResetKey((k) => k + 1);
  }, []);

  return { menus, addMenu, removeMenu, resetMenus, replaceMenus, resetKey };
}
