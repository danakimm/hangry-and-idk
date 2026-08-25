import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import {
  createTestD1,
  applyMigrationFiles,
  applyMigrations,
  disposeTestD1,
} from "../users/helpers.ts";

describe("0011 migration", () => {
  test("applies 0001+0010+0011 to fresh database", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const trigger = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_menu_sets_limit_insert'")
      .first<{ name: string }>();
    assert.notEqual(trigger, null);
    assert.equal(trigger!.name, "trg_menu_sets_limit_insert");

    const trigger2 = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_menu_sets_limit_update'")
      .first<{ name: string }>();
    assert.notEqual(trigger2, null);
    assert.equal(trigger2!.name, "trg_menu_sets_limit_update");

    await disposeTestD1();
  });

  test("applies 0011 to existing 0010 database", async () => {
    const db = await createTestD1();
    await applyMigrationFiles(db, ["0001_users.sql", "0010_menu_sets.sql"]);

    await db.prepare(
      `INSERT INTO users (id, firebase_uid, created_at, last_seen_at)
       VALUES ('upgrade-user', 'upgrade-firebase', 1000, 1000)`,
    ).run();
    await db.prepare(
      `INSERT INTO menu_sets
         (id, owner_user_id, name, version, is_default, created_at, updated_at)
       VALUES ('upgrade-set', 'upgrade-user', 'existing', 1, 1, 1000, 1000)`,
    ).run();

    const before = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_menu_sets_limit_insert'")
      .first();
    assert.equal(before, null);

    await applyMigrationFiles(db, ["0011_menu_sets_concurrency.sql"]);

    const trigger = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_menu_sets_limit_insert'")
      .first<{ name: string }>();
    assert.notEqual(trigger, null);

    const existing = await db
      .prepare("SELECT name FROM menu_sets WHERE id = 'upgrade-set'")
      .first<{ name: string }>();
    assert.equal(existing?.name, "existing");

    await disposeTestD1();
  });

  test("trigger prevents insert when 20 active sets exist", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    await db.prepare(
      `INSERT INTO users (id, firebase_uid, created_at, last_seen_at) VALUES ('u1', 'fb1', 1000, 1000)`
    ).run();

    for (let i = 0; i < 20; i++) {
      await db.prepare(
        `INSERT INTO menu_sets (id, owner_user_id, name, version, is_default, created_at, updated_at)
         VALUES (?, 'u1', ?, 1, ?, ?, ?)`
      ).bind(`set-${i}`, `name ${i}`, i === 0 ? 1 : 0, 1000 + i, 1000 + i).run();

      await db.prepare(
        `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
         VALUES (?, ?, 'A', 'a', '🍚', '#ef4938', 0)`
      ).bind(`item-${i}-1`, `set-${i}`).run();

      await db.prepare(
        `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
         VALUES (?, ?, 'B', 'b', '🥟', '#f6c84a', 1)`
      ).bind(`item-${i}-2`, `set-${i}`).run();
    }

    await assert.rejects(
      () =>
        db.prepare(
          `INSERT INTO menu_sets (id, owner_user_id, name, version, is_default, created_at, updated_at)
           VALUES ('overflow', 'u1', 'overflow', 1, 0, 9999, 9999)`
        ).run(),
      (error: Error) => {
        assert.match(error.message, /MENU_SET_LIMIT_REACHED/);
        return true;
      },
    );

    await disposeTestD1();
  });

  test("trigger allows insert when archived sets reduce active count below 20", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    await db.prepare(
      `INSERT INTO users (id, firebase_uid, created_at, last_seen_at) VALUES ('u2', 'fb2', 1000, 1000)`
    ).run();

    for (let i = 0; i < 20; i++) {
      const archivedAt = i < 5 ? null : 1000;
      await db.prepare(
        `INSERT INTO menu_sets (id, owner_user_id, name, version, is_default, created_at, updated_at, archived_at)
         VALUES (?, 'u2', ?, 1, 0, ?, ?, ?)`
      ).bind(`set2-${i}`, `name ${i}`, 1000 + i, 1000 + i, archivedAt).run();

      await db.prepare(
        `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
         VALUES (?, ?, 'A', 'a', '🍚', '#ef4938', 0)`
      ).bind(`item2-${i}-1`, `set2-${i}`).run();

      await db.prepare(
        `INSERT INTO menu_set_items (id, menu_set_id, name, normalized_name, emoji, color, position)
         VALUES (?, ?, 'B', 'b', '🥟', '#f6c84a', 1)`
      ).bind(`item2-${i}-2`, `set2-${i}`).run();
    }

    await db.prepare(
      `INSERT INTO menu_sets (id, owner_user_id, name, version, is_default, created_at, updated_at)
       VALUES ('new-set', 'u2', 'new set', 1, 0, 9999, 9999)`
    ).run();

    const count = await db
      .prepare("SELECT COUNT(*) as cnt FROM menu_sets WHERE owner_user_id = 'u2' AND archived_at IS NULL")
      .first<{ cnt: number }>();
    assert.equal(count!.cnt, 6);

    await disposeTestD1();
  });

  after(async () => {
    await disposeTestD1();
  });
});
