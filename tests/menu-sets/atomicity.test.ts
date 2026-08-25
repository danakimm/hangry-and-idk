import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import {
  createTestD1,
  applyMigrations,
  disposeTestD1,
  createTestClock,
  createTestIdGenerator,
  createQueuedIdGenerator,
} from "../users/helpers.ts";
import { createUserRepository } from "../../features/users/server/repository.server.ts";
import { createMenuSetRepository } from "../../features/menu-sets/server/repository.server.ts";
import type {
  D1Database,
  D1PreparedStatement,
} from "../../server/db/types.server.ts";

let db: D1Database;
const clock = createTestClock(1700000000);
const idGenerator = createTestIdGenerator();

async function ensureUser(userId: string, firebaseUid: string) {
  const userRepo = createUserRepository({ db, clock, idGenerator });
  idGenerator.setNext(userId);
  await userRepo.upsert(firebaseUid);
}

function createPreReadBarrierDb(delegate: D1Database, expectedReads = 2): D1Database {
  let completedReads = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let batchQueue: Promise<void> = Promise.resolve();
  const underlyingStatements = new WeakMap<
    D1PreparedStatement,
    D1PreparedStatement
  >();

  function wrapStatement(
    statement: D1PreparedStatement,
    shouldWait: boolean,
  ): D1PreparedStatement {
    const wrapped: D1PreparedStatement = {
      bind(...values) {
        return wrapStatement(statement.bind(...values), shouldWait);
      },
      async first<T>(columnName?: string) {
        const result = await statement.first<T>(columnName);
        if (shouldWait && completedReads < expectedReads) {
          completedReads += 1;
          if (completedReads === expectedReads) release();
          await barrier;
        }
        return result;
      },
      run<T>() {
        return statement.run<T>();
      },
      all<T>() {
        return statement.all<T>();
      },
      raw<T>() {
        return statement.raw<T>();
      },
    };
    underlyingStatements.set(wrapped, statement);
    return wrapped;
  }

  return {
    prepare(query) {
      const isAggregateHeaderRead =
        query.includes("FROM menu_sets") &&
        query.includes("WHERE id = ? AND owner_user_id = ?");
      return wrapStatement(delegate.prepare(query), isAggregateHeaderRead);
    },
    batch<T>(statements: D1PreparedStatement[]) {
      const unwrapped = statements.map(
        (statement) => underlyingStatements.get(statement) ?? statement,
      );
      const result = batchQueue.then(() => delegate.batch<T>(unwrapped));
      batchQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    exec(query) {
      return delegate.exec(query);
    },
  };
}

describe("menu_sets atomicity and concurrency", async () => {
  db = await createTestD1();
  await applyMigrations(db);
  await ensureUser("owner-atom", "fb-uid-atom");

  test("updateAggregate is fully atomic: header+delete+insert in single batch", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-atomic-1",
      ownerUserId: "owner-atom",
      name: "atomic test",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "at-item-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "at-item-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    const result = await repo.updateAggregate(
      "ms-atomic-1",
      "owner-atom",
      1,
      {
        name: "atomic v2",
        items: [
          { id: "at-item-new-1", name: "X", normalizedName: "x", emoji: "🍣", color: "#2d7a57", position: 0 },
          { id: "at-item-new-2", name: "Y", normalizedName: "y", emoji: "🍝", color: "#f4ebd8", position: 1 },
          { id: "at-item-new-3", name: "Z", normalizedName: "z", emoji: "🍽️", color: "#ee7654", position: 2 },
        ],
      },
      1700000060,
    );

    assert.equal(result.status, "updated");
    if (result.status === "updated") {
      assert.equal(result.aggregate.menuSet.name, "atomic v2");
      assert.equal(result.aggregate.menuSet.version, 2);
      assert.equal(result.aggregate.items.length, 3);
      assert.equal(result.aggregate.items[0].name, "X");
      assert.equal(result.aggregate.items[1].name, "Y");
      assert.equal(result.aggregate.items[2].name, "Z");

      const oldItems = await db
        .prepare("SELECT * FROM menu_set_items WHERE id IN ('at-item-1', 'at-item-2')")
        .all();
      assert.equal(oldItems.results.length, 0, "Old items should be deleted");
    }
  });

  test("stale update never deletes latest items (D1 proof)", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-stale-guard",
      ownerUserId: "owner-atom",
      name: "stale guard",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "sg-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "sg-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    await repo.updateAggregate(
      "ms-stale-guard",
      "owner-atom",
      1,
      {
        name: "stale guard v2",
        items: [
          { id: "sg-v2-1", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
          { id: "sg-v2-2", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
        ],
      },
      1700000060,
    );

    const staleResult = await repo.updateAggregate(
      "ms-stale-guard",
      "owner-atom",
      1,
      {
        name: "SHOULD NOT APPLY",
        items: [
          { id: "sg-stale-1", name: "X", normalizedName: "x", emoji: "🍽️", color: "#000000", position: 0 },
        ],
      },
      1700000100,
    );

    assert.equal(staleResult.status, "versionConflict");

    const agg = await repo.findByIdAndOwner("ms-stale-guard", "owner-atom");
    assert.notEqual(agg, null);
    assert.equal(agg!.menuSet.name, "stale guard v2");
    assert.equal(agg!.menuSet.version, 2);
    assert.equal(agg!.items.length, 2);
    assert.equal(agg!.items[0].name, "C");
    assert.equal(agg!.items[1].name, "D");

    const staleItems = await db
      .prepare("SELECT * FROM menu_set_items WHERE id IN ('sg-stale-1')")
      .all();
    assert.equal(staleItems.results.length, 0, "Stale items should never be inserted");
  });

  test("concurrent update cannot replace winner items after both pre-reads", async () => {
    const setupRepo = createMenuSetRepository({ db, clock, idGenerator });
    await setupRepo.create({
      id: "ms-concurrent",
      ownerUserId: "owner-atom",
      name: "concurrent",
      version: 1,
      isDefault: false,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "cc-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });

    const barrierDb = createPreReadBarrierDb(db);
    const repo1 = createMenuSetRepository({
      db: barrierDb,
      clock,
      idGenerator: createQueuedIdGenerator(["mutation-token-1"]),
    });
    const repo2 = createMenuSetRepository({
      db: barrierDb,
      clock,
      idGenerator: createQueuedIdGenerator(["mutation-token-2"]),
    });

    const [r1, r2] = await Promise.all([
      repo1.updateAggregate(
        "ms-concurrent", "owner-atom", 1,
        { name: "update-1", items: [{ id: "cc-r1", name: "X", normalizedName: "x", emoji: "🍚", color: "#ef4938", position: 0 }] },
        1700000200,
      ),
      repo2.updateAggregate(
        "ms-concurrent", "owner-atom", 1,
        { name: "update-2", items: [{ id: "cc-r2", name: "Y", normalizedName: "y", emoji: "🥟", color: "#f6c84a", position: 0 }] },
        1700000201,
      ),
    ]);

    const results = [r1, r2];
    const updated = results.filter((r) => r.status === "updated");
    const conflicts = results.filter((r) => r.status === "versionConflict");
    assert.equal(updated.length, 1, "Exactly one update should succeed");
    assert.equal(conflicts.length, 1, "Exactly one should conflict");

    const agg = await setupRepo.findByIdAndOwner("ms-concurrent", "owner-atom");
    assert.equal(agg!.menuSet.version, 2);
    const winner = r1.status === "updated"
      ? { name: "update-1", itemName: "X" }
      : { name: "update-2", itemName: "Y" };
    assert.equal(agg!.menuSet.name, winner.name);
    assert.deepEqual(agg!.items.map((item) => item.name), [winner.itemName]);
  });

  test("trigger prevents creating more than 20 active menu sets", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-limit", "fb-uid-limit");

    for (let i = 0; i < 20; i++) {
      idGenerator.setNext(`ms-limit-${i}`);
      await repo.create({
        id: `ms-limit-${i}`,
        ownerUserId: "owner-limit",
        name: `set ${i}`,
        version: 1,
        isDefault: i === 0,
        createdAt: 1700000000 + i,
        updatedAt: 1700000000 + i,
        items: [
          { id: `li-${i}-1`, name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
          { id: `li-${i}-2`, name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
        ],
      });
    }

    await assert.rejects(
      () =>
        repo.create({
          id: "ms-limit-overflow",
          ownerUserId: "owner-limit",
          name: "overflow",
          version: 1,
          isDefault: false,
          createdAt: 1700000200,
          updatedAt: 1700000200,
          items: [
            { id: "lo-1", name: "X", normalizedName: "x", emoji: "🍚", color: "#ef4938", position: 0 },
            { id: "lo-2", name: "Y", normalizedName: "y", emoji: "🥟", color: "#f6c84a", position: 1 },
          ],
        }),
      (error: Error) => {
        assert.match(error.message, /MENU_SET_LIMIT_REACHED|제한/);
        return true;
      },
    );

    const count = await repo.countActiveByOwner("owner-limit");
    assert.equal(count, 20);
  });

  test("concurrent first create: exactly one becomes default", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-first", "fb-uid-first");

    const [r1, r2] = await Promise.all([
      (async () => {
        idGenerator.setNext("ms-first-1");
        try {
          await repo.create({
            id: "ms-first-1",
            ownerUserId: "owner-first",
            name: "first 1",
            version: 1,
            isDefault: true,
            createdAt: 1700000000,
            updatedAt: 1700000000,
            items: [
              { id: "f1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
              { id: "f1-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
            ],
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e };
        }
      })(),
      (async () => {
        idGenerator.setNext("ms-first-2");
        try {
          await repo.create({
            id: "ms-first-2",
            ownerUserId: "owner-first",
            name: "first 2",
            version: 1,
            isDefault: true,
            createdAt: 1700000001,
            updatedAt: 1700000001,
            items: [
              { id: "f2-1", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
              { id: "f2-2", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
            ],
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e };
        }
      })(),
    ]);

    const successes = [r1, r2].filter((r) => r.ok);
    const failures = [r1, r2].filter((r) => !r.ok);
    assert.equal(successes.length, 2);
    assert.equal(failures.length, 0);

    const list = await repo.listByOwner("owner-first");
    const defaults = list.filter((a) => a.menuSet.isDefault);
    assert.equal(defaults.length, 1, "Exactly one should be default");
  });

  test("archive+fallback default is atomic", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-archive", "fb-uid-archive");

    idGenerator.setNext("ms-arch-1");
    await repo.create({
      id: "ms-arch-1",
      ownerUserId: "owner-archive",
      name: "archive 1",
      version: 1,
      isDefault: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "ar1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "ar1-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    idGenerator.setNext("ms-arch-2");
    await repo.create({
      id: "ms-arch-2",
      ownerUserId: "owner-archive",
      name: "archive 2",
      version: 1,
      isDefault: false,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "ar2-1", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
        { id: "ar2-2", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
      ],
    });

    const result = await repo.archiveWithFallback("ms-arch-1", "owner-archive", 1, 1700000300);
    assert.equal(result.status, "archived");
    assert.equal(result.fallbackDefaultId, "ms-arch-2");

    const agg1 = await repo.findByIdAndOwner("ms-arch-1", "owner-archive");
    assert.notEqual(agg1, null);
    assert.notEqual(agg1!.menuSet.archivedAt, null);

    const agg2 = await repo.findByIdAndOwner("ms-arch-2", "owner-archive");
    assert.notEqual(agg2, null);
    assert.equal(agg2!.menuSet.isDefault, true);
  });

  test("fallback failure rolls back the default archive", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-archive-fail", "fb-uid-archive-fail");
    await repo.create({
      id: "ms-arch-fail-1",
      ownerUserId: "owner-archive-fail",
      name: "archive failure default",
      version: 1,
      isDefault: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "af1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "af1-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });
    await repo.create({
      id: "ms-arch-fail-2",
      ownerUserId: "owner-archive-fail",
      name: "archive failure fallback",
      version: 1,
      isDefault: false,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "af2-1", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
        { id: "af2-2", name: "D", normalizedName: "d", emoji: "🍝", color: "#f4ebd8", position: 1 },
      ],
    });

    await db.prepare(
      `CREATE TRIGGER fail_fallback_for_test
       BEFORE UPDATE OF is_default ON menu_sets
       WHEN NEW.id = 'ms-arch-fail-2' AND NEW.is_default = 1
       BEGIN
         SELECT RAISE(ABORT, 'forced fallback failure');
       END`,
    ).run();

    await assert.rejects(() =>
      repo.archiveWithFallback(
        "ms-arch-fail-1",
        "owner-archive-fail",
        1,
        1700000400,
      ),
    );

    const archived = await repo.findByIdAndOwner(
      "ms-arch-fail-1",
      "owner-archive-fail",
    );
    assert.equal(archived!.menuSet.archivedAt, null);
    assert.equal(archived!.menuSet.isDefault, true);

    await db.prepare("DROP TRIGGER fail_fallback_for_test").run();
  });

  after(async () => {
    await disposeTestD1();
  });
});
