import type { DecisionHistoryCreateRequest } from "../shared/contract.ts";
import type { MenuItem } from "../../roulette/shared/contract.ts";

export type DecisionDraft = DecisionHistoryCreateRequest;

export function createDecisionDraft(
  selected: MenuItem,
  candidates: MenuItem[],
  source: DecisionHistoryCreateRequest["source"],
  clientRequestId = crypto.randomUUID(),
): DecisionDraft {
  const snapshot = (item: MenuItem) => ({
    name: item.name,
    emoji: item.emoji,
    color: item.color,
  });
  return {
    clientRequestId,
    selected: snapshot(selected),
    candidates: candidates.map(snapshot),
    source:
      source.type === "menu-set"
        ? {
            type: "menu-set",
            menuSetId: source.menuSetId,
            menuSetName: source.menuSetName,
          }
        : { type: "temporary", menuSetId: null, menuSetName: null },
  };
}
