import type { MenuSetItemRequest } from "../shared/contract.ts";
import {
  MENU_SET_NAME_MIN_LENGTH,
  MENU_SET_NAME_MAX_LENGTH,
  MENU_ITEM_NAME_MIN_LENGTH,
  MENU_ITEM_NAME_MAX_LENGTH,
  MENU_SET_ITEMS_MIN,
  MENU_SET_ITEMS_MAX,
  MENU_SET_MAX_ACTIVE,
} from "../shared/constants.ts";
import {
  isValidMenuColor,
  isValidMenuEmoji,
  normalizeMenuName,
} from "../../roulette/shared/menu-snapshot-policy.ts";

export {
  MENU_SET_NAME_MIN_LENGTH,
  MENU_SET_NAME_MAX_LENGTH,
  MENU_ITEM_NAME_MIN_LENGTH,
  MENU_ITEM_NAME_MAX_LENGTH,
  MENU_SET_ITEMS_MIN,
  MENU_SET_ITEMS_MAX,
  MENU_SET_MAX_ACTIVE,
};

export type ValidationError = { field: string; message: string };

export function normalizeName(name: string): string {
  return normalizeMenuName(name);
}

export function validateMenuSetName(name: string): ValidationError | null {
  const normalized = normalizeName(name);
  if (normalized.length < MENU_SET_NAME_MIN_LENGTH) {
    return { field: "name", message: "메뉴판 이름을 입력해주세요." };
  }
  if (normalized.length > MENU_SET_NAME_MAX_LENGTH) {
    return {
      field: "name",
      message: `메뉴판 이름은 ${MENU_SET_NAME_MAX_LENGTH}자 이하여야 합니다.`,
    };
  }
  return null;
}

export function validateMenuItemName(name: string): ValidationError | null {
  const normalized = normalizeName(name);
  if (normalized.length < MENU_ITEM_NAME_MIN_LENGTH) {
    return { field: "item.name", message: "메뉴 이름을 입력해주세요." };
  }
  if (normalized.length > MENU_ITEM_NAME_MAX_LENGTH) {
    return {
      field: "item.name",
      message: `메뉴 이름은 ${MENU_ITEM_NAME_MAX_LENGTH}자 이하여야 합니다.`,
    };
  }
  return null;
}

export function validateItems(
  items: MenuSetItemRequest[],
): ValidationError | null {
  if (items.length < MENU_SET_ITEMS_MIN) {
    return {
      field: "items",
      message: `메뉴는 최소 ${MENU_SET_ITEMS_MIN}개 이상이어야 합니다.`,
    };
  }
  if (items.length > MENU_SET_ITEMS_MAX) {
    return {
      field: "items",
      message: `메뉴는 최대 ${MENU_SET_ITEMS_MAX}개까지 가능합니다.`,
    };
  }

  const normalizedNames = new Set<string>();
  for (const item of items) {
    const nameError = validateMenuItemName(item.name);
    if (nameError) return nameError;

    const normalized = normalizeName(item.name).toLowerCase();
    if (normalizedNames.has(normalized)) {
      return {
        field: "item.name",
        message: "같은 메뉴판에 중복된 메뉴 이름이 있습니다.",
      };
    }
    normalizedNames.add(normalized);
  }

  return null;
}

export function validateColor(color: string): boolean {
  return isValidMenuColor(color);
}

export function validateEmoji(emoji: string): boolean {
  return isValidMenuEmoji(emoji);
}

export function validateVersion(version: unknown): version is number {
  return (
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version > 0
  );
}
