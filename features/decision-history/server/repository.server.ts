import { normalizeD1Error } from "../../../server/db/d1.server.ts";
import type { D1Database } from "../../../server/db/types.server.ts";
import { DECISION_HISTORY_LIMIT } from "../shared/constants.ts";
import type { DecisionHistoryRecord } from "./model.server.ts";
import type { DecisionHistoryRepository } from "./ports.server.ts";
import { validateAndNormalizeDecision } from "./validation.server.ts";

type DecisionHistoryRow = {
  id: string;
  owner_user_id: string;
  client_request_id: string;
  selected_name: string;
  selected_emoji: string;
  selected_color: string;
  source_type: "temporary" | "menu_set";
  source_menu_set_id: string | null;
  source_menu_set_name: string | null;
  candidates_json: string;
  created_at: number;
};

const SELECT_COLUMNS = `id, owner_user_id, client_request_id, selected_name, selected_emoji,
  selected_color, source_type, source_menu_set_id, source_menu_set_name, candidates_json, created_at`;
const CORRUPTED_RECORD_MESSAGE = "손상된 결정 기록입니다.";

function corruptedRecord(): never {
  throw new Error(CORRUPTED_RECORD_MESSAGE);
}

function toRecord(row: DecisionHistoryRow): DecisionHistoryRecord {
  let candidates: unknown;
  try {
    candidates = JSON.parse(row.candidates_json);
  } catch {
    corruptedRecord();
  }

  const source =
    row.source_type === "temporary"
      ? {
          type: "temporary" as const,
          menuSetId: row.source_menu_set_id,
          menuSetName: row.source_menu_set_name,
        }
      : row.source_type === "menu_set"
        ? {
            type: "menu-set" as const,
            menuSetId: row.source_menu_set_id,
            menuSetName: row.source_menu_set_name,
          }
        : null;

  const rawCommand = {
    clientRequestId: row.client_request_id,
    selected: {
      name: row.selected_name,
      emoji: row.selected_emoji,
      color: row.selected_color,
    },
    candidates,
    source,
  };
  const validated = validateAndNormalizeDecision(rawCommand);
  if (!validated.ok) corruptedRecord();

  // Stored snapshots are canonical. Silently normalizing a malformed DB row
  // would hide corruption and make historical data change on read.
  const normalized = validated.command;
  const isCanonical =
    normalized.clientRequestId === row.client_request_id &&
    normalized.selected.name === row.selected_name &&
    normalized.selected.emoji === row.selected_emoji &&
    normalized.selected.color === row.selected_color &&
    JSON.stringify(normalized.candidates) === row.candidates_json &&
    (normalized.source.type === "temporary"
      ? row.source_type === "temporary" &&
        row.source_menu_set_id === null &&
        row.source_menu_set_name === null
      : row.source_type === "menu_set" &&
        normalized.source.menuSetId === row.source_menu_set_id &&
        normalized.source.menuSetName === row.source_menu_set_name);
  if (!isCanonical) {
    corruptedRecord();
  }
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.owner_user_id !== "string" ||
    !row.owner_user_id ||
    !Number.isSafeInteger(row.created_at)
  ) {
    corruptedRecord();
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    clientRequestId: normalized.clientRequestId,
    selected: normalized.selected,
    candidates: normalized.candidates,
    source: normalized.source,
    createdAt: row.created_at,
  };
}

function rethrowRepositoryError(error: unknown): never {
  if (error instanceof Error && error.message === CORRUPTED_RECORD_MESSAGE) {
    throw error;
  }
  throw new Error(normalizeD1Error(error));
}

export function createDecisionHistoryRepository(deps: {
  db: D1Database;
}): DecisionHistoryRepository {
  const { db } = deps;

  return {
    async createOrGet(record) {
      try {
        const insert = db
          .prepare(
            `INSERT INTO decision_history
              (id, owner_user_id, client_request_id, selected_name, selected_emoji, selected_color,
               source_type, source_menu_set_id, source_menu_set_name, candidates_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_user_id, client_request_id) DO NOTHING`,
          )
          .bind(
            record.id,
            record.ownerUserId,
            record.clientRequestId,
            record.selected.name,
            record.selected.emoji,
            record.selected.color,
            record.source.type === "menu-set" ? "menu_set" : "temporary",
            record.source.menuSetId,
            record.source.menuSetName,
            JSON.stringify(record.candidates),
            record.createdAt,
          );
        const select = db
          .prepare(
            `SELECT ${SELECT_COLUMNS}
             FROM decision_history
             WHERE owner_user_id = ? AND client_request_id = ?`,
          )
          .bind(record.ownerUserId, record.clientRequestId);

        // Keep the insert and read in one D1 batch so another writer's
        // retention trigger cannot evict this row between the two statements.
        const [insertResult, selectResult] = await db.batch<DecisionHistoryRow>([
          insert,
          select,
        ]);
        const row = selectResult.results[0];
        if (!row) throw new Error("inserted decision history was not found");
        return {
          record: toRecord(row),
          created: insertResult.meta.changes > 0,
        };
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async listByOwner(ownerUserId) {
      try {
        const result = await db
          .prepare(
            `SELECT ${SELECT_COLUMNS}
             FROM decision_history
             WHERE owner_user_id = ?
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?`,
          )
          .bind(ownerUserId, DECISION_HISTORY_LIMIT)
          .all<DecisionHistoryRow>();
        return result.results.map(toRecord);
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async deleteByIdAndOwner(id, ownerUserId) {
      try {
        const result = await db
          .prepare("DELETE FROM decision_history WHERE id = ? AND owner_user_id = ?")
          .bind(id, ownerUserId)
          .run();
        return result.meta.changes > 0;
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async deleteAllByOwner(ownerUserId) {
      try {
        const result = await db
          .prepare("DELETE FROM decision_history WHERE owner_user_id = ?")
          .bind(ownerUserId)
          .run();
        return result.meta.changes;
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },
  };
}
