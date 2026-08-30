import type {
  CreateDecisionCommand,
  DecisionMenuSnapshot,
  DecisionSourceSnapshot,
} from "./model.server.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMenu(value: unknown): DecisionMenuSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.emoji !== "string" ||
    typeof value.color !== "string"
  ) {
    return null;
  }
  return { name: value.name, emoji: value.emoji, color: value.color };
}

function parseSource(value: unknown): DecisionSourceSnapshot | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
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
  return {
    type: "menu-set",
    menuSetId: value.menuSetId,
    menuSetName: value.menuSetName,
  };
}

export function parseCreateDecisionCommand(
  value: unknown,
): CreateDecisionCommand | null {
  if (
    !isRecord(value) ||
    typeof value.clientRequestId !== "string" ||
    !Array.isArray(value.candidates)
  ) {
    return null;
  }
  const selected = parseMenu(value.selected);
  const source = parseSource(value.source);
  const candidates: DecisionMenuSnapshot[] = [];
  for (const candidateValue of value.candidates) {
    const candidate = parseMenu(candidateValue);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  return selected && source
    ? { clientRequestId: value.clientRequestId, selected, candidates, source }
    : null;
}
