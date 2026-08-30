import assert from "node:assert/strict";
import test, { after, describe } from "node:test";
import { applyMigrationFiles, applyMigrations, createTestD1, disposeTestD1 } from "../users/helpers.ts";

async function insertUser(db: Awaited<ReturnType<typeof createTestD1>>, id: string) {
  await db.prepare("INSERT INTO users (id, firebase_uid, created_at, last_seen_at) VALUES (?, ?, 1, 1)").bind(id, `fb-${id}`).run();
}

async function ensureMigrations(db: Awaited<ReturnType<typeof createTestD1>>) {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_history'").first();
  if (!table) await applyMigrations(db);
}

async function insertDecision(db: Awaited<ReturnType<typeof createTestD1>>, id: string, owner: string, createdAt: number) {
  await db.prepare(`INSERT INTO decision_history
    (id, owner_user_id, client_request_id, selected_name, selected_emoji, selected_color, source_type, source_menu_set_id, source_menu_set_name, candidates_json, created_at)
    VALUES (?, ?, ?, 'A', '🍚', '#112233', 'temporary', NULL, NULL, '[{"name":"A","emoji":"🍚","color":"#112233"}]', ?)`)
    .bind(id, owner, `req-${id}`, createdAt).run();
}

describe("decision_history migration", () => {
  test("applies on fresh and existing 0011 databases", async () => {
    const db = await createTestD1();
    await applyMigrations(db);
    assert.equal((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_history'").first<{ name: string }>())?.name, "decision_history");
    await disposeTestD1();
    const existing = await createTestD1();
    await applyMigrationFiles(existing, ["0001_users.sql", "0010_menu_sets.sql", "0011_menu_sets_concurrency.sql"]);
    await applyMigrationFiles(existing, ["0012_decision_history.sql"]);
    assert.equal((await existing.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_history'").first<{ name: string }>())?.name, "decision_history");
    await disposeTestD1();
  });

  test("creates columns, foreign key, indexes, and trigger", async () => {
    const db = await createTestD1(); await ensureMigrations(db);
    const columns = await db.prepare("PRAGMA table_info(decision_history)").all<{ name: string }>();
    assert.deepEqual(columns.results.map((row) => row.name), ["id", "owner_user_id", "client_request_id", "selected_name", "selected_emoji", "selected_color", "source_type", "source_menu_set_id", "source_menu_set_name", "candidates_json", "created_at"]);
    const fk = await db.prepare("PRAGMA foreign_key_list(decision_history)").all<{ table: string; on_delete: string }>();
    assert.ok(fk.results.some((row) => row.table === "users" && row.on_delete === "CASCADE"));
    const objects = await db.prepare("SELECT name, type FROM sqlite_master WHERE tbl_name='decision_history'").all<{ name: string; type: string }>();
    const names = objects.results.map((row) => row.name);
    assert.ok(names.includes("idx_decision_history_owner_request"));
    assert.ok(names.includes("idx_decision_history_owner_created"));
    assert.ok(names.includes("trg_decision_history_keep_latest_ten"));
  });

  test("enforces source combinations and valid JSON", async () => {
    const db = await createTestD1(); await ensureMigrations(db); await insertUser(db, "migration-u1");
    const base = `INSERT INTO decision_history (id, owner_user_id, client_request_id, selected_name, selected_emoji, selected_color, source_type, source_menu_set_id, source_menu_set_name, candidates_json, created_at)`;
    await assert.rejects(() => db.prepare(`${base} VALUES ('x','migration-u1','r1','A','🍚','#000000','temporary','ms',NULL,'[]',1)`).run());
    await assert.rejects(() => db.prepare(`${base} VALUES ('y','migration-u1','r2','A','🍚','#000000','menu_set',NULL,'Set','[]',1)`).run());
    await assert.rejects(() => db.prepare(`${base} VALUES ('z','migration-u1','r3','A','🍚','#000000','temporary',NULL,NULL,'bad',1)`).run());
  });

  test("retains latest ten per owner and uses rowid for ties", async () => {
    const db = await createTestD1(); await ensureMigrations(db); await insertUser(db, "limit-u1"); await insertUser(db, "limit-u2");
    for (let i = 0; i < 11; i++) await insertDecision(db, `a${i}`, "limit-u1", 100);
    for (let i = 0; i < 11; i++) await insertDecision(db, `b${i}`, "limit-u2", i);
    const a = await db.prepare("SELECT id FROM decision_history WHERE owner_user_id='limit-u1' ORDER BY rowid").all<{ id: string }>();
    const b = await db.prepare("SELECT id FROM decision_history WHERE owner_user_id='limit-u2' ORDER BY created_at").all<{ id: string }>();
    assert.equal(a.results.length, 10); assert.equal(a.results[0].id, "a1"); assert.equal(a.results[9].id, "a10");
    assert.equal(b.results.length, 10); assert.equal(b.results[0].id, "b1");
  });

  after(disposeTestD1);
});
