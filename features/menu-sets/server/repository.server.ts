import type {
  D1Database,
  Clock,
  IdGenerator,
} from "../../../server/db/types.server.ts";
import { normalizeD1Error } from "../../../server/db/d1.server.ts";
import type { MenuSetRepository } from "./ports.server.ts";
import type {
  MenuSetRecord,
  MenuSetItemRecord,
  MenuSetAggregate,
  UpdateAggregateInput,
  AggregateWriteResult,
} from "./model.server.ts";

type MenuSetRow = {
  id: string;
  owner_user_id: string;
  name: string;
  version: number;
  is_default: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

type MenuSetItemRow = {
  id: string;
  menu_set_id: string;
  name: string;
  normalized_name: string;
  emoji: string;
  color: string;
  position: number;
};

function toRecord(row: MenuSetRow): MenuSetRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    version: row.version,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toItemRecord(row: MenuSetItemRow): MenuSetItemRecord {
  return {
    id: row.id,
    menuSetId: row.menu_set_id,
    name: row.name,
    normalizedName: row.normalized_name,
    emoji: row.emoji,
    color: row.color,
    position: row.position,
  };
}

export type MenuSetRepositoryDependencies = {
  db: D1Database;
  clock: Clock;
  idGenerator: IdGenerator;
};

export function createMenuSetRepository(
  deps: MenuSetRepositoryDependencies,
): MenuSetRepository {
  const { db, clock, idGenerator } = deps;

  async function findMenuSetRow(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetRow | null> {
    try {
      return (
        (await db
          .prepare(
            `SELECT id, owner_user_id, name, version, is_default, created_at, updated_at, archived_at
             FROM menu_sets
             WHERE id = ? AND owner_user_id = ?`,
          )
          .bind(menuSetId, ownerUserId)
          .first<MenuSetRow>()) ?? null
      );
    } catch (error) {
      throw new Error(normalizeD1Error(error));
    }
  }

  async function findItemRows(menuSetId: string): Promise<MenuSetItemRow[]> {
    try {
      const result = await db
        .prepare(
          `SELECT id, menu_set_id, name, normalized_name, emoji, color, position
           FROM menu_set_items
           WHERE menu_set_id = ?
           ORDER BY position ASC`,
        )
        .bind(menuSetId)
        .all<MenuSetItemRow>();
      return result.results;
    } catch (error) {
      throw new Error(normalizeD1Error(error));
    }
  }

  async function findAggregate(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetAggregate | null> {
    const row = await findMenuSetRow(menuSetId, ownerUserId);
    if (!row) return null;
    const items = await findItemRows(menuSetId);
    return { menuSet: toRecord(row), items: items.map(toItemRecord) };
  }

  return {
    async listByOwner(ownerUserId: string): Promise<MenuSetAggregate[]> {
      try {
        const result = await db
          .prepare(
            `SELECT id, owner_user_id, name, version, is_default, created_at, updated_at, archived_at
             FROM menu_sets
             WHERE owner_user_id = ? AND archived_at IS NULL
             ORDER BY is_default DESC, updated_at DESC`,
          )
          .bind(ownerUserId)
          .all<MenuSetRow>();
        const aggregates: MenuSetAggregate[] = [];
        for (const row of result.results) {
          const items = await findItemRows(row.id);
          aggregates.push({ menuSet: toRecord(row), items: items.map(toItemRecord) });
        }
        return aggregates;
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async findByIdAndOwner(
      menuSetId: string,
      ownerUserId: string,
    ): Promise<MenuSetAggregate | null> {
      return findAggregate(menuSetId, ownerUserId);
    },

    async countActiveByOwner(ownerUserId: string): Promise<number> {
      try {
        const result = await db
          .prepare(
            `SELECT COUNT(*) as cnt FROM menu_sets
             WHERE owner_user_id = ? AND archived_at IS NULL`,
          )
          .bind(ownerUserId)
          .first<{ cnt: number }>();
        return result?.cnt ?? 0;
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async create(data): Promise<void> {
      try {
        const statements = [
          db
            .prepare(
              `INSERT INTO menu_sets (id, owner_user_id, name, version, is_default, created_at, updated_at)
               VALUES (?, ?, ?, ?,
                 CASE
                   WHEN ? = 1 AND NOT EXISTS (
                     SELECT 1 FROM menu_sets
                     WHERE owner_user_id = ? AND is_default = 1 AND archived_at IS NULL
                   ) THEN 1
                   ELSE 0
                 END,
                 ?, ?)`,
            )
            .bind(
              data.id,
              data.ownerUserId,
              data.name,
              data.version,
              data.isDefault ? 1 : 0,
              data.ownerUserId,
              data.createdAt,
              data.updatedAt,
            ),
          ...data.items.map((item) =>
            db
              .prepare(
                `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                item.id,
                data.id,
                item.name,
                item.normalizedName,
                item.emoji,
                item.color,
                item.position,
              ),
          ),
        ];
        await db.batch(statements);
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async updateAggregate(
      menuSetId: string,
      ownerUserId: string,
      currentVersion: number,
      input: UpdateAggregateInput,
      updatedAt: number,
    ): Promise<AggregateWriteResult> {
      const existing = await findMenuSetRow(menuSetId, ownerUserId);
      if (!existing || existing.archived_at !== null) return { status: "notFound" };
      if (existing.version !== currentVersion) return { status: "versionConflict" };

      // D1 batch rolls back on SQL failure, but a zero-row CAS UPDATE is still a
      // successful statement. Use a transaction-local marker in the name column
      // so every following item statement is conditional on this exact write
      // having won the CAS. The final statement restores the validated name.
      const writeMarker = `__menu_set_write__${idGenerator.uuid()}`;

      const headerStmt = db
        .prepare(
          `UPDATE menu_sets
           SET name = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND owner_user_id = ? AND version = ? AND archived_at IS NULL`,
        )
        .bind(writeMarker, updatedAt, menuSetId, ownerUserId, currentVersion);

      const deleteStmt = db
        .prepare(
          `DELETE FROM menu_set_items
           WHERE menu_set_id = ?
             AND EXISTS (
               SELECT 1 FROM menu_sets
               WHERE id = ? AND owner_user_id = ? AND version = ?
                 AND name = ? AND archived_at IS NULL
             )`,
        )
        .bind(
          menuSetId,
          menuSetId,
          ownerUserId,
          currentVersion + 1,
          writeMarker,
        );

      const insertStmts = input.items.map((item) =>
        db
          .prepare(
            `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM menu_sets
               WHERE id = ? AND owner_user_id = ? AND version = ?
                 AND name = ? AND archived_at IS NULL
             )`,
          )
          .bind(
            item.id ?? idGenerator.uuid(),
            menuSetId,
            item.name,
            item.normalizedName,
            item.emoji,
            item.color,
            item.position,
            menuSetId,
            ownerUserId,
            currentVersion + 1,
            writeMarker,
          ),
      );

      const finalizeStmt = db
        .prepare(
          `UPDATE menu_sets
           SET name = ?
           WHERE id = ? AND owner_user_id = ? AND version = ?
             AND name = ? AND archived_at IS NULL`,
        )
        .bind(
          input.name,
          menuSetId,
          ownerUserId,
          currentVersion + 1,
          writeMarker,
        );

      try {
        const batchResult = await db.batch([
          headerStmt,
          deleteStmt,
          ...insertStmts,
          finalizeStmt,
        ]);
        if (!batchResult[0].success || batchResult[0].meta.changes === 0) {
          return { status: "versionConflict" };
        }
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }

      const aggregate = await findAggregate(menuSetId, ownerUserId);
      if (!aggregate) return { status: "notFound" };
      return { status: "updated", aggregate };
    },

    async archiveWithFallback(
      menuSetId: string,
      ownerUserId: string,
      currentVersion: number,
      archivedAt: number,
    ) {
      try {
        const existing = await findMenuSetRow(menuSetId, ownerUserId);
        if (!existing || existing.archived_at !== null) return { status: "notFound" as const };
        if (existing.version !== currentVersion) return { status: "versionConflict" as const };

        const writeMarker = `__menu_set_archive__${idGenerator.uuid()}`;

        const archiveStmt = db
          .prepare(
            `UPDATE menu_sets
             SET name = ?, archived_at = ?, is_default = 0,
                 version = version + 1, updated_at = ?
             WHERE id = ? AND owner_user_id = ? AND version = ? AND archived_at IS NULL`,
          )
          .bind(
            writeMarker,
            archivedAt,
            archivedAt,
            menuSetId,
            ownerUserId,
            currentVersion,
          );

        const fallbackStmt = db
          .prepare(
            `UPDATE menu_sets
             SET is_default = 1, version = version + 1, updated_at = ?
             WHERE id = (
               SELECT id FROM menu_sets
               WHERE owner_user_id = ? AND archived_at IS NULL
               ORDER BY updated_at DESC, id ASC
               LIMIT 1
             )
               AND ? = 1
               AND NOT EXISTS (
                 SELECT 1 FROM menu_sets
                 WHERE owner_user_id = ? AND is_default = 1 AND archived_at IS NULL
               )
               AND EXISTS (
                 SELECT 1 FROM menu_sets
                 WHERE id = ? AND owner_user_id = ? AND version = ?
                   AND name = ? AND archived_at = ?
               )`,
          )
          .bind(
            archivedAt,
            ownerUserId,
            existing.is_default,
            ownerUserId,
            menuSetId,
            ownerUserId,
            currentVersion + 1,
            writeMarker,
            archivedAt,
          );

        const finalizeStmt = db
          .prepare(
            `UPDATE menu_sets
             SET name = ?
             WHERE id = ? AND owner_user_id = ? AND version = ?
               AND name = ? AND archived_at = ?`,
          )
          .bind(
            existing.name,
            menuSetId,
            ownerUserId,
            currentVersion + 1,
            writeMarker,
            archivedAt,
          );

        const results = await db.batch([archiveStmt, fallbackStmt, finalizeStmt]);

        if (!results[0].success || results[0].meta.changes === 0) {
          return { status: "versionConflict" as const };
        }

        let fallbackDefaultId: string | null = null;
        if (existing.is_default) {
          const fallback = await db
            .prepare(
              `SELECT id FROM menu_sets
               WHERE owner_user_id = ? AND archived_at IS NULL AND is_default = 1
               LIMIT 1`,
            )
            .bind(ownerUserId)
            .first<{ id: string }>();
          fallbackDefaultId = fallback?.id ?? null;
        }

        return { status: "archived" as const, fallbackDefaultId };
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async setDefault(menuSetId: string, ownerUserId: string) {
      try {
        const existing = await findMenuSetRow(menuSetId, ownerUserId);
        if (!existing || existing.archived_at !== null) return { status: "notFound" as const };

        const now = clock.nowSeconds();
        const writeMarker = `__menu_set_default__${idGenerator.uuid()}`;
        const claimStmt = db
          .prepare(
            `UPDATE menu_sets
             SET name = ?
             WHERE id = ? AND owner_user_id = ? AND version = ?
               AND name = ? AND archived_at IS NULL`,
          )
          .bind(
            writeMarker,
            menuSetId,
            ownerUserId,
            existing.version,
            existing.name,
          );
        const clearStmt = db
          .prepare(
            `UPDATE menu_sets
             SET is_default = 0, version = version + 1, updated_at = ?
             WHERE owner_user_id = ? AND id <> ? AND is_default = 1
               AND archived_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM menu_sets
                 WHERE id = ? AND owner_user_id = ? AND name = ? AND archived_at IS NULL
               )`,
          )
          .bind(
            now,
            ownerUserId,
            menuSetId,
            menuSetId,
            ownerUserId,
            writeMarker,
          );
        const setStmt = db
          .prepare(
            `UPDATE menu_sets
             SET name = ?, is_default = 1,
                 version = CASE WHEN is_default = 1 THEN version ELSE version + 1 END,
                 updated_at = ?
             WHERE id = ? AND owner_user_id = ? AND name = ? AND archived_at IS NULL`,
          )
          .bind(existing.name, now, menuSetId, ownerUserId, writeMarker);

        const results = await db.batch([claimStmt, clearStmt, setStmt]);
        if (!results[0].success || results[0].meta.changes === 0) {
          const current = await findMenuSetRow(menuSetId, ownerUserId);
          return {
            status: current && current.archived_at === null
              ? "versionConflict" as const
              : "notFound" as const,
          };
        }
        return { status: "updated" as const };
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },
  };
}
