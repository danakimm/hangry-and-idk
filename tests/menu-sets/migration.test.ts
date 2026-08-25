import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import { createTestD1, applyMigrations, disposeTestD1 } from "../users/helpers.ts";


describe("menu_sets migration", () => {
  test("applies all migrations to fresh database", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const usersTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .first<{ name: string }>();
    assert.notEqual(usersTable, null);

    const menuSetsTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_sets'")
      .first<{ name: string }>();
    assert.notEqual(menuSetsTable, null);
    assert.equal(menuSetsTable!.name, "menu_sets");

    const itemsTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_set_items'")
      .first<{ name: string }>();
    assert.notEqual(itemsTable, null);
    assert.equal(itemsTable!.name, "menu_set_items");

    await disposeTestD1();
  });

  test("menu_sets has correct schema", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const columns = await db
      .prepare("PRAGMA table_info(menu_sets)")
      .all<{ name: string; type: string; notnull: number; pk: number }>();

    const colMap = new Map(columns.results.map((c) => [c.name, c]));

    assert.equal(colMap.get("id")?.type, "TEXT");
    assert.equal(colMap.get("id")?.pk, 1);
    assert.equal(colMap.get("id")?.notnull, 1);

    assert.equal(colMap.get("owner_user_id")?.type, "TEXT");
    assert.equal(colMap.get("owner_user_id")?.notnull, 1);

    assert.equal(colMap.get("name")?.type, "TEXT");
    assert.equal(colMap.get("name")?.notnull, 1);

    assert.equal(colMap.get("version")?.type, "INTEGER");
    assert.equal(colMap.get("version")?.notnull, 1);

    assert.equal(colMap.get("is_default")?.type, "INTEGER");
    assert.equal(colMap.get("is_default")?.notnull, 1);

    assert.equal(colMap.get("created_at")?.type, "INTEGER");
    assert.equal(colMap.get("created_at")?.notnull, 1);

    assert.equal(colMap.get("updated_at")?.type, "INTEGER");
    assert.equal(colMap.get("updated_at")?.notnull, 1);

    assert.equal(colMap.get("archived_at")?.type, "INTEGER");

    await disposeTestD1();
  });

  test("menu_set_items has correct schema", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const columns = await db
      .prepare("PRAGMA table_info(menu_set_items)")
      .all<{ name: string; type: string; notnull: number; pk: number }>();

    const colMap = new Map(columns.results.map((c) => [c.name, c]));

    assert.equal(colMap.get("id")?.type, "TEXT");
    assert.equal(colMap.get("id")?.pk, 1);
    assert.equal(colMap.get("id")?.notnull, 1);

    assert.equal(colMap.get("menu_set_id")?.type, "TEXT");
    assert.equal(colMap.get("menu_set_id")?.notnull, 1);

    assert.equal(colMap.get("name")?.type, "TEXT");
    assert.equal(colMap.get("name")?.notnull, 1);

    assert.equal(colMap.get("normalized_name")?.type, "TEXT");
    assert.equal(colMap.get("normalized_name")?.notnull, 1);

    assert.equal(colMap.get("emoji")?.type, "TEXT");
    assert.equal(colMap.get("emoji")?.notnull, 1);

    assert.equal(colMap.get("color")?.type, "TEXT");
    assert.equal(colMap.get("color")?.notnull, 1);

    assert.equal(colMap.get("position")?.type, "INTEGER");
    assert.equal(colMap.get("position")?.notnull, 1);

    await disposeTestD1();
  });

  test("unique indexes exist on menu_set_items", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const indexes = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='menu_set_items'")
      .all<{ name: string }>();

    const indexNames = indexes.results.map((i) => i.name);
    assert.ok(
      indexNames.includes("idx_menu_set_items_unique_name"),
      `Expected idx_menu_set_items_unique_name in ${indexNames.join(", ")}`,
    );
    assert.ok(
      indexNames.includes("idx_menu_set_items_unique_position"),
      `Expected idx_menu_set_items_unique_position in ${indexNames.join(", ")}`,
    );

    await disposeTestD1();
  });

  test("owner index exists on menu_sets", async () => {
    const db = await createTestD1();
    await applyMigrations(db);

    const indexes = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='menu_sets'")
      .all<{ name: string }>();

    const indexNames = indexes.results.map((i) => i.name);
    assert.ok(
      indexNames.includes("idx_menu_sets_owner_active"),
      `Expected idx_menu_sets_owner_active in ${indexNames.join(", ")}`,
    );

    await disposeTestD1();
  });

  test("migration is idempotent", async () => {
    const db = await createTestD1();
    await applyMigrations(db);
    await applyMigrations(db);

    const menuSetsTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_sets'")
      .first<{ name: string }>();
    assert.notEqual(menuSetsTable, null);

    await disposeTestD1();
  });

  after(async () => {
    await disposeTestD1();
  });
});
