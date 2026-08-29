import type {
  ArchiveMenuSetCommand,
  CreateMenuSetCommand,
  UpdateMenuSetCommand,
} from "./model.server.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): CreateMenuSetCommand["items"][number] | null {
  if (!isRecord(value)) return null;
  if (
    value.id !== null &&
    (typeof value.id !== "string" || value.id.length === 0)
  ) {
    return null;
  }
  if (
    typeof value.name !== "string" ||
    typeof value.emoji !== "string" ||
    typeof value.color !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    emoji: value.emoji,
    color: value.color,
  };
}

function parseItems(value: unknown): CreateMenuSetCommand["items"] | null {
  if (!Array.isArray(value)) return null;
  const items: CreateMenuSetCommand["items"] = [];
  for (const candidate of value) {
    const item = parseItem(candidate);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

export function parseCreateMenuSetCommand(
  value: unknown,
): CreateMenuSetCommand | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const items = parseItems(value.items);
  if (!items) return null;
  return { name: value.name, items };
}

export function parseUpdateMenuSetCommand(
  value: unknown,
): UpdateMenuSetCommand | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.version) ||
    typeof value.name !== "string"
  ) {
    return null;
  }
  const items = parseItems(value.items);
  if (!items) return null;
  return { version: value.version as number, name: value.name, items };
}

export function parseArchiveMenuSetCommand(
  value: unknown,
): ArchiveMenuSetCommand | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.version)) return null;
  return { version: value.version as number };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
