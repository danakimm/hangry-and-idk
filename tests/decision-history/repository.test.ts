import assert from "node:assert/strict";
import test, { after, describe } from "node:test";
import { createDecisionHistoryRepository } from "../../features/decision-history/server/repository.server.ts";
import type { DecisionHistoryRecord } from "../../features/decision-history/server/model.server.ts";
import { applyMigrations, createTestD1, disposeTestD1 } from "../users/helpers.ts";

const menu = (name: string) => ({ name, emoji: "🍚", color: "#112233" });
const record = (id: string, ownerUserId: string, createdAt: number, clientRequestId = `req-${id}`): DecisionHistoryRecord => ({
  id, ownerUserId, clientRequestId, selected: menu("A"), candidates: [menu("A"), menu("B")],
  source: { type: "menu-set", menuSetId: "ms-old", menuSetName: "점심 메뉴" }, createdAt,
});

async function setup(users: [string, string][]) {
  const db = await createTestD1();
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_history'").first();
  if (!table) await applyMigrations(db);
  for (const [id, uid] of users) await db.prepare("INSERT INTO users VALUES (?, ?, 1, 1)").bind(id, uid).run();
  return db;
}

describe("decision history repository", () => {
  test("round trips snapshots, isolates owners, retains ten, and deletes by owner", async () => {
    const db = await setup([["repo-u1", "repo-fb1"], ["repo-u2", "repo-fb2"]]);
    const repo = createDecisionHistoryRepository({ db });
    for (let i = 0; i < 11; i++) await repo.createOrGet(record(`ra${i}`, "repo-u1", i));
    await repo.createOrGet(record("rb1", "repo-u2", 100));
    const list = await repo.listByOwner("repo-u1");
    assert.equal(list.length, 10); assert.equal(list[0].id, "ra10"); assert.equal(list.at(-1)?.id, "ra1");
    assert.deepEqual(list[0].candidates, [menu("A"), menu("B")]); assert.equal(list[0].source.menuSetName, "점심 메뉴");
    assert.deepEqual((await repo.listByOwner("repo-u2")).map((item) => item.id), ["rb1"]);
    assert.equal(await repo.deleteByIdAndOwner("rb1", "repo-u1"), false);
    assert.equal(await repo.deleteByIdAndOwner("rb1", "repo-u2"), true);
    assert.equal(await repo.deleteAllByOwner("repo-u1"), 10); assert.equal((await repo.listByOwner("repo-u1")).length, 0);
  });

  test("is idempotent by owner and request while preserving the first payload", async () => {
    const db = await setup([["idem-u1", "idem-fb1"], ["idem-u2", "idem-fb2"]]);
    const repo = createDecisionHistoryRepository({ db });
    const first = await repo.createOrGet(record("first", "idem-u1", 1, "shared"));
    const retry = await repo.createOrGet({ ...record("second", "idem-u1", 2, "shared"), selected: menu("B") });
    const other = await repo.createOrGet(record("other", "idem-u2", 3, "shared"));
    assert.equal(first.created, true); assert.equal(retry.created, false); assert.equal(retry.record.id, "first"); assert.equal(retry.record.selected.name, "A"); assert.equal(other.created, true);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM decision_history WHERE owner_user_id IN ('idem-u1','idem-u2')").first<{ count: number }>())?.count, 2);
  });

  test("fails loudly for corrupted JSON rows", async () => {
    const db = await setup([["corrupt-u1", "corrupt-fb1"]]);
    const repo = createDecisionHistoryRepository({ db }); await repo.createOrGet(record("corrupt-a", "corrupt-u1", 1));
    await db.prepare("PRAGMA ignore_check_constraints = ON").run();
    await db.prepare("UPDATE decision_history SET candidates_json='bad' WHERE owner_user_id='corrupt-u1'").run();
    await assert.rejects(() => repo.listByOwner("corrupt-u1"), /손상된/);
  });

  test("fails loudly for structurally invalid snapshot rows", async () => {
    const db = await setup([["structure-u1", "structure-fb1"]]);
    const repo = createDecisionHistoryRepository({ db });
    await repo.createOrGet(record("structure-a", "structure-u1", 1));
    await db
      .prepare(
        "UPDATE decision_history SET selected_color='#ffffff' WHERE owner_user_id='structure-u1'",
      )
      .run();
    await assert.rejects(() => repo.listByOwner("structure-u1"), /손상된/);
  });

  test("does not silently strip unexpected snapshot fields", async () => {
    const db = await setup([["extra-u1", "extra-fb1"]]);
    const repo = createDecisionHistoryRepository({ db });
    await repo.createOrGet(record("extra-a", "extra-u1", 1));
    await db
      .prepare(
        `UPDATE decision_history
         SET candidates_json = '[{"name":"A","emoji":"🍚","color":"#112233","id":"stale"},{"name":"B","emoji":"🍚","color":"#112233"}]'
         WHERE owner_user_id = 'extra-u1'`,
      )
      .run();
    await assert.rejects(() => repo.listByOwner("extra-u1"), /손상된/);
  });

  test("concurrent creates retain at most ten for the exact owner", async () => {
    const db = await setup([
      ["concurrent-u1", "concurrent-fb1"],
      ["concurrent-u2", "concurrent-fb2"],
    ]);
    const repo = createDecisionHistoryRepository({ db });
    await Promise.all([
      ...Array.from({ length: 25 }, (_, index) =>
        repo.createOrGet(record(`concurrent-a${index}`, "concurrent-u1", index)),
      ),
      ...Array.from({ length: 7 }, (_, index) =>
        repo.createOrGet(record(`concurrent-b${index}`, "concurrent-u2", index)),
      ),
    ]);

    const ownerOne = await repo.listByOwner("concurrent-u1");
    const ownerTwo = await repo.listByOwner("concurrent-u2");
    assert.equal(ownerOne.length, 10);
    assert.equal(ownerTwo.length, 7);
    assert.ok(ownerOne.every((item) => item.ownerUserId === "concurrent-u1"));
    assert.ok(ownerTwo.every((item) => item.ownerUserId === "concurrent-u2"));
  });

  after(disposeTestD1);
});
