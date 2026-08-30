import type {
  CreateDecisionCommand,
  DecisionMenuSnapshot,
  DecisionSourceSnapshot,
} from "./model.server.ts";
import {
  CLIENT_REQUEST_ID_MAX_LENGTH,
  MENU_SET_ID_MAX_LENGTH,
} from "../shared/constants.ts";
import {
  MENU_SET_ITEMS_MAX,
  MENU_SET_ITEMS_MIN,
  normalizeName,
  validateColor,
  validateEmoji,
  validateMenuItemName,
  validateMenuSetName,
} from "../../menu-sets/server/validation.server.ts";

export type DecisionValidationResult =
  | { ok: true; command: CreateDecisionCommand }
  | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMenu(value: unknown): DecisionMenuSnapshot | null {
  if (
    !isObject(value) ||
    typeof value.name !== "string" ||
    typeof value.emoji !== "string" ||
    typeof value.color !== "string"
  ) {
    return null;
  }

  const menu = {
    name: normalizeName(value.name),
    emoji: value.emoji,
    color: value.color,
  };
  if (
    validateMenuItemName(menu.name) ||
    !validateEmoji(menu.emoji) ||
    !validateColor(menu.color)
  ) {
    return null;
  }
  return menu;
}

function normalizeSource(value: unknown): DecisionSourceSnapshot | null {
  if (!isObject(value) || typeof value.type !== "string") return null;

  if (value.type === "temporary") {
    return value.menuSetId === null && value.menuSetName === null
      ? { type: "temporary", menuSetId: null, menuSetName: null }
      : null;
  }

  if (
    value.type !== "menu-set" ||
    typeof value.menuSetId !== "string" ||
    typeof value.menuSetName !== "string"
  ) {
    return null;
  }
  const menuSetId = value.menuSetId.trim();
  if (!menuSetId || menuSetId.length > MENU_SET_ID_MAX_LENGTH) return null;
  if (validateMenuSetName(value.menuSetName)) return null;

  return {
    type: "menu-set",
    menuSetId,
    menuSetName: normalizeName(value.menuSetName),
  };
}

export function validateAndNormalizeDecision(
  value: unknown,
): DecisionValidationResult {
  if (!isObject(value) || typeof value.clientRequestId !== "string") {
    return { ok: false, message: "요청 ID가 올바르지 않습니다." };
  }
  const clientRequestId = value.clientRequestId.trim();
  if (
    !clientRequestId ||
    clientRequestId.length > CLIENT_REQUEST_ID_MAX_LENGTH
  ) {
    return { ok: false, message: "요청 ID가 올바르지 않습니다." };
  }

  if (
    !Array.isArray(value.candidates) ||
    value.candidates.length < MENU_SET_ITEMS_MIN ||
    value.candidates.length > MENU_SET_ITEMS_MAX
  ) {
    return {
      ok: false,
      message: `후보 메뉴는 ${MENU_SET_ITEMS_MIN}~${MENU_SET_ITEMS_MAX}개여야 합니다.`,
    };
  }

  const candidates: DecisionMenuSnapshot[] = [];
  const seen = new Set<string>();
  for (const candidateValue of value.candidates) {
    const candidate = normalizeMenu(candidateValue);
    if (!candidate) {
      return { ok: false, message: "후보 메뉴가 올바르지 않습니다." };
    }
    const key = candidate.name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: "중복된 메뉴 이름이 있습니다." };
    }
    seen.add(key);
    candidates.push(candidate);
  }

  const selected = normalizeMenu(value.selected);
  if (!selected) {
    return { ok: false, message: "선택 메뉴가 올바르지 않습니다." };
  }
  if (
    !candidates.some(
      (candidate) =>
        candidate.name === selected.name &&
        candidate.emoji === selected.emoji &&
        candidate.color === selected.color,
    )
  ) {
    return { ok: false, message: "선택 메뉴가 후보 목록과 일치하지 않습니다." };
  }

  const source = normalizeSource(value.source);
  if (!source) {
    return { ok: false, message: "메뉴 출처가 올바르지 않습니다." };
  }

  return {
    ok: true,
    command: { clientRequestId, selected, candidates, source },
  };
}
