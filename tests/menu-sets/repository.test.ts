import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import {
  createTestD1,
  applyMigrations,
  disposeTestD1,
  createTestClock,
  createTestIdGenerator,
} from "../users/helpers.ts";
import { createUserRepository } from "../../features/users/server/repository.server.ts";
import { createMenuSetRepository } from "../../features/menu-sets/server/repository.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";

let db: D1Database;
const clock = createTestClock(1700000000);
const idGenerator = createTestIdGenerator();

async function ensureUser(userId: string, firebaseUid: string) {
  const userRepo = createUserRepository({ db, clock, idGenerator });
  idGenerator.setNext(userId);
  await userRepo.upsert(firebaseUid);
}

describe("menu_sets D1 repository", async () => {
  db = await createTestD1();
  await applyMigrations(db);
  await ensureUser("owner-001", "fb-uid-001");

  test("create inserts menu set and items atomically via batch", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-001",
      ownerUserId: "owner-001",
      name: "회사 점심",
      version: 1,
      isDefault: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "item-001", name: "한식", normalizedName: "한식", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "item-002", name: "중식", normalizedName: "중식", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    const agg = await repo.findByIdAndOwner("ms-001", "owner-001");
    assert.notEqual(agg, null);
    assert.equal(agg!.menuSet.name, "회사 점심");
    assert.equal(agg!.items.length, 2);
  });

  test("updateAggregate succeeds and replaces items", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    const result = await repo.updateAggregate(
      "ms-001",
      "owner-001",
      1,
      {
        name: "회사 점심 v2",
        items: [
          { id: "item-upd-001", name: "일식", normalizedName: "일식", emoji: "🍣", color: "#2d7a57", position: 0 },
          { id: "item-upd-002", name: "양식", normalizedName: "양식", emoji: "🍝", color: "#f4ebd8", position: 1 },
        ],
      },
      1700000060,
    );

    assert.equal(result.status, "updated");
    if (result.status === "updated") {
      assert.equal(result.aggregate.menuSet.name, "회사 점심 v2");
      assert.equal(result.aggregate.menuSet.version, 2);
      assert.equal(result.aggregate.items.length, 2);
      assert.equal(result.aggregate.items[0].name, "일식");
    }
  });

  test("updateAggregate returns versionConflict for stale version", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    const result = await repo.updateAggregate(
      "ms-001",
      "owner-001",
      1,
      {
        name: "stale",
        items: [
          { id: null, name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
          { id: null, name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
        ],
      },
      1700000100,
    );

    assert.equal(result.status, "versionConflict");

    const agg = await repo.findByIdAndOwner("ms-001", "owner-001");
    assert.equal(agg!.menuSet.name, "회사 점심 v2");
    assert.equal(agg!.menuSet.version, 2);
  });

  test("stale version leaves header and items unchanged (D1 proof)", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });

    const before = await repo.findByIdAndOwner("ms-001", "owner-001");
    assert.notEqual(before, null);

    const result = await repo.updateAggregate(
      "ms-001",
      "owner-001",
      999,
      {
        name: "SHOULD NOT UPDATE",
        items: [
          { id: null, name: "X", normalizedName: "x", emoji: "🍽️", color: "#000000", position: 0 },
        ],
      },
      1700000200,
    );

    assert.equal(result.status, "versionConflict");

    const after = await repo.findByIdAndOwner("ms-001", "owner-001");
    assert.notEqual(after, null);
    assert.equal(after!.menuSet.name, before!.menuSet.name);
    assert.equal(after!.menuSet.version, before!.menuSet.version);
    assert.deepEqual(
      after!.items.map((i) => i.name),
      before!.items.map((i) => i.name),
    );
  });

  test("updateAggregate rolls back header and items on insert failure", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });

    await repo.create({
      id: "ms-rollback",
      ownerUserId: "owner-001",
      name: "rollback test",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "rb-item-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "rb-item-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    const before = await repo.findByIdAndOwner("ms-rollback", "owner-001");
    assert.notEqual(before, null);
    const beforeName = before!.menuSet.name;
    const beforeVersion = before!.menuSet.version;

    await assert.rejects(
      () =>
        repo.updateAggregate(
          "ms-rollback",
          "owner-001",
          1,
          {
            name: "should rollback",
            items: [
              { id: "rb-item-1", name: "X", normalizedName: "x", emoji: "🍚", color: "#ef4938", position: 0 },
              { id: "rb-item-1", name: "Y", normalizedName: "y", emoji: "🥟", color: "#f6c84a", position: 1 },
            ],
          },
          1700000300,
        ),
      (error: Error) => {
        assert.match(error.message, /중복|UNIQUE/);
        return true;
      },
    );

    const after = await repo.findByIdAndOwner("ms-rollback", "owner-001");
    assert.notEqual(after, null);
    assert.equal(after!.menuSet.name, beforeName);
    assert.equal(after!.menuSet.version, beforeVersion);
  });

  test("archiveWithFallback marks archived and clears default atomically", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-archive-1",
      ownerUserId: "owner-001",
      name: "archive test 1",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "item-a1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "item-a2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });
    await repo.setDefault("ms-archive-1", "owner-001");

    const afterDefault = await repo.findByIdAndOwner("ms-archive-1", "owner-001");
    const result = await repo.archiveWithFallback(
      "ms-archive-1",
      "owner-001",
      afterDefault!.menuSet.version,
      1700000300,
    );
    assert.equal(result.status, "archived");

    const list = await repo.listByOwner("owner-001");
    assert.ok(!list.some((a) => a.menuSet.id === "ms-archive-1"));
  });

  test("archiveWithFallback returns versionConflict for stale version", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-archive-stale",
      ownerUserId: "owner-001",
      name: "stale archive",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "item-s1", name: "X", normalizedName: "x", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "item-s2", name: "Y", normalizedName: "y", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    const result = await repo.archiveWithFallback("ms-archive-stale", "owner-001", 999, 1700000400);
    assert.equal(result.status, "versionConflict");

    const agg = await repo.findByIdAndOwner("ms-archive-stale", "owner-001");
    assert.equal(agg!.menuSet.archivedAt, null);
  });

  test("setDefault clears old default and sets new one atomically", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-setdef-1",
      ownerUserId: "owner-001",
      name: "default 1",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "item-sd1a", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "item-sd1b", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });
    await repo.create({
      id: "ms-setdef-2",
      ownerUserId: "owner-001",
      name: "default 2",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "item-sd2a", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
        { id: "item-sd2b", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
      ],
    });

    await repo.setDefault("ms-setdef-1", "owner-001");
    await repo.setDefault("ms-setdef-2", "owner-001");

    const list = await repo.listByOwner("owner-001");
    const d1 = list.find((a) => a.menuSet.id === "ms-setdef-1");
    const d2 = list.find((a) => a.menuSet.id === "ms-setdef-2");
    assert.equal(d1?.menuSet.isDefault, false);
    assert.equal(d2?.menuSet.isDefault, true);
  });

  test("unique name constraint prevents duplicate normalized names", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await assert.rejects(
      () =>
        repo.create({
          id: "ms-dup-name",
          ownerUserId: "owner-001",
          name: "dup test",
          version: 1,
          isDefault: false,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          items: [
            { id: "dup-1", name: "한식", normalizedName: "한식", emoji: "🍚", color: "#ef4938", position: 0 },
            { id: "dup-2", name: "한식", normalizedName: "한식", emoji: "🥟", color: "#f6c84a", position: 1 },
          ],
        }),
      (error: Error) => {
        assert.match(error.message, /중복|UNIQUE/);
        return true;
      },
    );
  });

  test("unique position constraint prevents duplicate positions", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await assert.rejects(
      () =>
        repo.create({
          id: "ms-dup-pos",
          ownerUserId: "owner-001",
          name: "dup pos test",
          version: 1,
          isDefault: false,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          items: [
            { id: "pos-1", name: "한식", normalizedName: "한식", emoji: "🍚", color: "#ef4938", position: 0 },
            { id: "pos-2", name: "중식", normalizedName: "중식", emoji: "🥟", color: "#f6c84a", position: 0 },
          ],
        }),
      (error: Error) => {
        assert.match(error.message, /중복|UNIQUE/);
        return true;
      },
    );
  });

  test("concurrent-first create hint preserves one default without rejecting create", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-dupdef-1",
      ownerUserId: "owner-001",
      name: "dupdef 1",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "dd1a", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "dd1b", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });
    await repo.setDefault("ms-dupdef-1", "owner-001");

    await repo.create({
      id: "ms-dupdef-2",
      ownerUserId: "owner-001",
      name: "dupdef 2",
      version: 1,
      isDefault: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "dd2a", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
        { id: "dd2b", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
      ],
    });

    const list = await repo.listByOwner("owner-001");
    assert.equal(list.filter((aggregate) => aggregate.menuSet.isDefault).length, 1);
    assert.ok(list.some((aggregate) => aggregate.menuSet.id === "ms-dupdef-2"));
  });

  after(async () => {
    await disposeTestD1();
  });
});
