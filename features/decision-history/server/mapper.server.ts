import type {
  DecisionHistoryRecord,
  DecisionMenuSnapshot,
  DecisionSourceSnapshot,
} from "./model.server.ts";
import type {
  DecisionHistoryListResponse,
  DecisionHistoryResponse,
  DecisionMenuSnapshotResponse,
  DecisionSourceResponse,
} from "../shared/contract.ts";

function mapMenu(menu: DecisionMenuSnapshot): DecisionMenuSnapshotResponse {
  return { name: menu.name, emoji: menu.emoji, color: menu.color };
}

function mapSource(source: DecisionSourceSnapshot): DecisionSourceResponse {
  return source.type === "temporary"
    ? { type: "temporary", menuSetId: null, menuSetName: null }
    : {
        type: "menu-set",
        menuSetId: source.menuSetId,
        menuSetName: source.menuSetName,
      };
}

export function mapDecisionHistoryToResponse(
  record: DecisionHistoryRecord,
): DecisionHistoryResponse {
  return {
    id: record.id,
    selected: mapMenu(record.selected),
    candidates: record.candidates.map(mapMenu),
    source: mapSource(record.source),
    // SQLite stores epoch seconds, while JavaScript Date APIs consume milliseconds.
    createdAt: record.createdAt * 1_000,
  };
}

export function mapDecisionHistoryListToResponse(
  records: DecisionHistoryRecord[],
): DecisionHistoryListResponse {
  return { decisions: records.map(mapDecisionHistoryToResponse) };
}
