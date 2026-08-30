import {
  MAX_MENUS,
  MENU_ITEM_NAME_MAX_LENGTH,
  MENU_ITEM_NAME_MIN_LENGTH,
  MIN_MENUS,
} from "./constants.ts";

export function normalizeMenuName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function isValidMenuItemName(name: string): boolean {
  const normalized = normalizeMenuName(name);
  return (
    normalized.length >= MENU_ITEM_NAME_MIN_LENGTH &&
    normalized.length <= MENU_ITEM_NAME_MAX_LENGTH
  );
}

export function isValidMenuCandidateCount(count: number): boolean {
  return count >= MIN_MENUS && count <= MAX_MENUS;
}

export function isValidMenuColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

const EMOJI_PATTERN = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;

export function isValidMenuEmoji(emoji: string): boolean {
  return emoji.length > 0 && emoji.length <= 8 && EMOJI_PATTERN.test(emoji);
}
