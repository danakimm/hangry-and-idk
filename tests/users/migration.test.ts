import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import { createTestD1, disposeTestD1 } from "./helpers.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { D1Database } from "../../server/db/types.server.ts";

async function applyMigration(db: D1Database): Promise<void> {
  const migrationPath = resolve(process.cwd(), "migrations/0001_users.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const prepared = statements.map((s) => db.prepare(s));
  await db.batch(prepared);
}

describe("D1 migration", () => {
  test("applies migration to fresh database", async () => {
    const db = await createTestD1();
    await applyMigration(db);

    const result = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .first<{ name: string }>();
    assert.notEqual(result, null);
    assert.equal(result!.name, "users");
    await disposeTestD1();
  });

  test("migration is idempotent on same database", async () => {
    const db = await createTestD1();
    await applyMigration(db);
    await applyMigration(db);

    const result = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .first<{ name: string }>();
    assert.notEqual(result, null);
    assert.equal(result!.name, "users");
    await disposeTestD1();
  });

  test("fresh database has correct schema", async () => {
    const db = await createTestD1();
    await applyMigration(db);

    const columns = await db
      .prepare("PRAGMA table_info(users)")
      .all<{ name: string; type: string; notnull: number; pk: number }>();

    const colMap = new Map(columns.results.map((c) => [c.name, c]));

    assert.equal(colMap.get("id")?.type, "TEXT");
    assert.equal(colMap.get("id")?.pk, 1);
    assert.equal(colMap.get("id")?.notnull, 1);

    assert.equal(colMap.get("firebase_uid")?.type, "TEXT");
    assert.equal(colMap.get("firebase_uid")?.notnull, 1);

    assert.equal(colMap.get("created_at")?.type, "INTEGER");
    assert.equal(colMap.get("created_at")?.notnull, 1);

    assert.equal(colMap.get("last_seen_at")?.type, "INTEGER");
    assert.equal(colMap.get("last_seen_at")?.notnull, 1);

    await disposeTestD1();
  });

  test("unique index exists on firebase_uid", async () => {
    const db = await createTestD1();
    await applyMigration(db);

    const indexes = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'")
      .all<{ name: string }>();

    const indexNames = indexes.results.map((i) => i.name);
    assert.ok(
      indexNames.includes("idx_users_firebase_uid"),
      `Expected idx_users_firebase_uid in ${indexNames.join(", ")}`,
    );
    await disposeTestD1();
  });

  test("failed batch rolls back all statements including earlier ones", async () => {
    const db = await createTestD1();

    const batch = [
      db.prepare("CREATE TABLE _rollback_probe (id TEXT PRIMARY KEY)"),
      db.prepare("INSERT INTO _rollback_probe (id) VALUES (?)").bind("probe-1"),
      db.prepare("SELECT * FROM nonexistent_table_that_does_not_exist"),
    ];

    await assert.rejects(
      () => db.batch(batch),
      (error: Error) => {
        assert.match(error.message, /nonexistent|no such table/i);
        return true;
      },
    );

    const probe = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_rollback_probe'",
      )
      .first<{ name: string }>();
    assert.equal(probe, null, "Temporary table from failed batch should not exist");

    await disposeTestD1();
  });

  after(async () => {
    await disposeTestD1();
  });
});
