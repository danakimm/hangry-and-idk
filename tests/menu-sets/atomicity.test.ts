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
import { createMenuSetService } from "../../features/menu-sets/server/service.server.ts";
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

async function assertOnlyActiveMenuSetIsDefault(
  ownerUserId: string,
  expectedMenuSetId: string,
) {
  const activeRows = await db
    .prepare(
      `SELECT id, is_default
       FROM menu_sets
       WHERE owner_user_id = ? AND archived_at IS NULL`,
    )
    .bind(ownerUserId)
    .all<{ id: string; is_default: number }>();
  assert.deepEqual(activeRows.results, [
    { id: expectedMenuSetId, is_default: 1 },
  ]);
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

function createBatchBarrierDb(delegate: D1Database, expectedBatches = 2): D1Database {
  let arrivedBatches = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let batchQueue: Promise<void> = Promise.resolve();

  return {
    prepare(query) {
      return delegate.prepare(query);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      arrivedBatches += 1;
      if (arrivedBatches === expectedBatches) release();
      await barrier;

      const result = batchQueue.then(() => delegate.batch<T>(statements));
      batchQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    exec(query) {
      return delegate.exec(query);
    },
  };
}

function createAfterFirstPreReadHookDb(
  delegate: D1Database,
  hook: () => Promise<void>,
): D1Database {
  let hookCompleted = false;
  const underlyingStatements = new WeakMap<
    D1PreparedStatement,
    D1PreparedStatement
  >();

  function wrapStatement(
    statement: D1PreparedStatement,
    shouldRunHook: boolean,
  ): D1PreparedStatement {
    const wrapped: D1PreparedStatement = {
      bind(...values) {
        return wrapStatement(statement.bind(...values), shouldRunHook);
      },
      async first<T>(columnName?: string) {
        const result = await statement.first<T>(columnName);
        if (shouldRunHook && !hookCompleted) {
          hookCompleted = true;
          await hook();
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
      const isMenuSetPreRead =
        query.includes("FROM menu_sets") &&
        query.includes("WHERE id = ? AND owner_user_id = ?");
      return wrapStatement(delegate.prepare(query), isMenuSetPreRead);
    },
    batch<T>(statements: D1PreparedStatement[]) {
      return delegate.batch<T>(
        statements.map((statement) => underlyingStatements.get(statement) ?? statement),
      );
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

  test("token-gated update commits header and items atomically", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await repo.create({
      id: "ms-atomic-1",
      ownerUserId: "owner-atom",
      name: "atomic test",
      version: 1,
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
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "cc-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });

    const [clientSnapshot1, clientSnapshot2] = await Promise.all([
      setupRepo.findByIdAndOwner("ms-concurrent", "owner-atom"),
      setupRepo.findByIdAndOwner("ms-concurrent", "owner-atom"),
    ]);
    assert.equal(clientSnapshot1!.menuSet.version, 1);
    assert.equal(clientSnapshot2!.menuSet.version, 1);

    const barrierDb = createBatchBarrierDb(db);
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

    const winnerResult = r1.status === "updated" ? r1 : r2;
    assert.equal(winnerResult.status, "updated");
    if (winnerResult.status !== "updated") assert.fail("Expected one updated result");

    const agg = await setupRepo.findByIdAndOwner("ms-concurrent", "owner-atom");
    assert.deepEqual(agg, winnerResult.aggregate);

    const tokenRow = await db
      .prepare("SELECT write_token FROM menu_sets WHERE id = 'ms-concurrent'")
      .first<{ write_token: string | null }>();
    assert.equal(tokenRow?.write_token, null);
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

  test("create before last-default archive leaves the created set as fallback default", async () => {
    await ensureUser("owner-create-first", "fb-uid-create-first");
    const repo = createMenuSetRepository({
      db,
      clock,
      idGenerator: createQueuedIdGenerator(["create-first-archive-token"]),
    });
    await repo.create({
      id: "ms-create-first-default",
      ownerUserId: "owner-create-first",
      name: "existing default",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "cf-default-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "cf-default-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    const service = createMenuSetService({
      repository: repo,
      clock,
      idGenerator: createQueuedIdGenerator([
        "ms-create-first-new",
        "cf-new-1",
        "cf-new-2",
      ]),
    });
    const created = await service.create("owner-create-first", {
      name: "created before archive",
      items: [
        { id: null, name: "C", emoji: "🍣", color: "#2d7a57" },
        { id: null, name: "D", emoji: "🍝", color: "#f4ebd8" },
      ],
    });
    assert.equal(created.ok, true);
    if (!created.ok) assert.fail("Expected create to succeed");
    assert.equal(created.data.menuSet.isDefault, false);

    const archived = await repo.archiveWithFallback(
      "ms-create-first-default",
      "owner-create-first",
      1,
      1700000250,
    );
    assert.equal(archived.status, "archived");

    await assertOnlyActiveMenuSetIsDefault(
      "owner-create-first",
      "ms-create-first-new",
    );
  });

  test("last-default archive between create pre-check and insert makes the new set default", async () => {
    await ensureUser("owner-archive-first", "fb-uid-archive-first");
    const repo = createMenuSetRepository({
      db,
      clock,
      idGenerator: createQueuedIdGenerator(["archive-first-token"]),
    });
    await repo.create({
      id: "ms-archive-first-default",
      ownerUserId: "owner-archive-first",
      name: "existing default",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "af-default-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
        { id: "af-default-2", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 1 },
      ],
    });

    let archivedAfterCount = false;
    const interleavingRepository = {
      ...repo,
      async countActiveByOwner(ownerUserId: string) {
        const count = await repo.countActiveByOwner(ownerUserId);
        const archived = await repo.archiveWithFallback(
          "ms-archive-first-default",
          ownerUserId,
          1,
          1700000260,
        );
        assert.equal(archived.status, "archived");
        archivedAfterCount = true;
        return count;
      },
    };
    const service = createMenuSetService({
      repository: interleavingRepository,
      clock,
      idGenerator: createQueuedIdGenerator([
        "ms-archive-first-new",
        "af-new-1",
        "af-new-2",
      ]),
    });

    const created = await service.create("owner-archive-first", {
      name: "created after archive",
      items: [
        { id: null, name: "C", emoji: "🍣", color: "#2d7a57" },
        { id: null, name: "D", emoji: "🍝", color: "#f4ebd8" },
      ],
    });
    assert.equal(archivedAfterCount, true);
    assert.equal(created.ok, true);
    if (!created.ok) assert.fail("Expected create to succeed");
    assert.equal(created.data.menuSet.isDefault, true);

    await assertOnlyActiveMenuSetIsDefault(
      "owner-archive-first",
      "ms-archive-first-new",
    );
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
    assert.equal(archived!.menuSet.version, 1);
    const fallback = await repo.findByIdAndOwner(
      "ms-arch-fail-2",
      "owner-archive-fail",
    );
    assert.equal(fallback!.menuSet.isDefault, false);
    assert.equal(fallback!.menuSet.version, 1);
    const tokenCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM menu_sets WHERE owner_user_id = ? AND write_token IS NOT NULL",
      )
      .bind("owner-archive-fail")
      .first<{ count: number }>();
    assert.equal(tokenCount?.count, 0);

    await db.prepare("DROP TRIGGER fail_fallback_for_test").run();
  });

  test("setDefault failure rolls back the default clear", async () => {
    const repo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-setdefault-fail", "fb-uid-setdefault-fail");
    await repo.create({
      id: "ms-sdf-1",
      ownerUserId: "owner-setdefault-fail",
      name: "setdefault fail 1",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "sdf1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });
    await repo.create({
      id: "ms-sdf-2",
      ownerUserId: "owner-setdefault-fail",
      name: "setdefault fail 2",
      version: 1,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "sdf2-1", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 0 },
      ],
    });

    await db.prepare(
      `CREATE TRIGGER fail_setdefault_for_test
       BEFORE UPDATE OF is_default ON menu_sets
       WHEN NEW.id = 'ms-sdf-2' AND NEW.is_default = 1
       BEGIN
         SELECT RAISE(ABORT, 'forced setdefault failure');
       END`,
    ).run();

    await assert.rejects(() =>
      repo.setDefault("ms-sdf-2", "owner-setdefault-fail"),
    );

    const agg1 = await repo.findByIdAndOwner("ms-sdf-1", "owner-setdefault-fail");
    assert.equal(agg1!.menuSet.isDefault, true);
    assert.equal(agg1!.menuSet.version, 1);
    const agg2 = await repo.findByIdAndOwner("ms-sdf-2", "owner-setdefault-fail");
    assert.equal(agg2!.menuSet.isDefault, false);
    assert.equal(agg2!.menuSet.version, 1);
    const tokenCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM menu_sets WHERE owner_user_id = ? AND write_token IS NOT NULL",
      )
      .bind("owner-setdefault-fail")
      .first<{ count: number }>();
    assert.equal(tokenCount?.count, 0);

    await db.prepare("DROP TRIGGER fail_setdefault_for_test").run();
  });

  test("target archive after setDefault pre-read keeps existing default", async () => {
    const setupRepo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-sdf-race", "fb-uid-sdf-race");
    await setupRepo.create({
      id: "ms-sdf-race-1",
      ownerUserId: "owner-sdf-race",
      name: "race default 1",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "sr1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });
    await setupRepo.create({
      id: "ms-sdf-race-2",
      ownerUserId: "owner-sdf-race",
      name: "race default 2",
      version: 1,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "sr2-1", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 0 },
      ],
    });

    const archiveRepo = createMenuSetRepository({
      db,
      clock,
      idGenerator: createQueuedIdGenerator(["archive-race-token"]),
    });
    const hookedDb = createAfterFirstPreReadHookDb(db, async () => {
      const archiveResult = await archiveRepo.archiveWithFallback(
        "ms-sdf-race-2",
        "owner-sdf-race",
        1,
        1700000500,
      );
      assert.equal(archiveResult.status, "archived");
    });
    const setDefaultRepo = createMenuSetRepository({
      db: hookedDb,
      clock,
      idGenerator: createQueuedIdGenerator(["setdefault-race-token"]),
    });

    const result = await setDefaultRepo.setDefault("ms-sdf-race-2", "owner-sdf-race");
    assert.equal(result.status, "notFound");

    const agg1 = await setupRepo.findByIdAndOwner("ms-sdf-race-1", "owner-sdf-race");
    assert.equal(agg1!.menuSet.isDefault, true);
    const tokenCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM menu_sets WHERE owner_user_id = ? AND write_token IS NOT NULL",
      )
      .bind("owner-sdf-race")
      .first<{ count: number }>();
    assert.equal(tokenCount?.count, 0);
  });

  test("target version change after setDefault pre-read keeps existing default", async () => {
    const setupRepo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-sdf-version", "fb-uid-sdf-version");
    await setupRepo.create({
      id: "ms-sdf-version-1",
      ownerUserId: "owner-sdf-version",
      name: "version default 1",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "sv1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });
    await setupRepo.create({
      id: "ms-sdf-version-2",
      ownerUserId: "owner-sdf-version",
      name: "version target 1",
      version: 1,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "sv2-1", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 0 },
      ],
    });

    const updateRepo = createMenuSetRepository({
      db,
      clock,
      idGenerator: createQueuedIdGenerator(["version-race-update-token"]),
    });
    const hookedDb = createAfterFirstPreReadHookDb(db, async () => {
      const updateResult = await updateRepo.updateAggregate(
        "ms-sdf-version-2",
        "owner-sdf-version",
        1,
        {
          name: "version target 2",
          items: [
            { id: "sv2-1", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 0 },
          ],
        },
        1700000550,
      );
      assert.equal(updateResult.status, "updated");
    });
    const setDefaultRepo = createMenuSetRepository({
      db: hookedDb,
      clock,
      idGenerator: createQueuedIdGenerator(["setdefault-version-race-token"]),
    });

    const result = await setDefaultRepo.setDefault(
      "ms-sdf-version-2",
      "owner-sdf-version",
    );
    assert.equal(result.status, "versionConflict");

    const existingDefault = await setupRepo.findByIdAndOwner(
      "ms-sdf-version-1",
      "owner-sdf-version",
    );
    assert.equal(existingDefault!.menuSet.isDefault, true);
    const target = await setupRepo.findByIdAndOwner(
      "ms-sdf-version-2",
      "owner-sdf-version",
    );
    assert.equal(target!.menuSet.isDefault, false);
    assert.equal(target!.menuSet.version, 2);
    assert.equal(target!.menuSet.name, "version target 2");
    const tokenCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM menu_sets WHERE owner_user_id = ? AND write_token IS NOT NULL",
      )
      .bind("owner-sdf-version")
      .first<{ count: number }>();
    assert.equal(tokenCount?.count, 0);
  });

  test("archive and setDefault race leaves at most one active default", async () => {
    const setupRepo = createMenuSetRepository({ db, clock, idGenerator });
    await ensureUser("owner-race-default", "fb-uid-race-default");
    await setupRepo.create({
      id: "ms-rd-1",
      ownerUserId: "owner-race-default",
      name: "race default 1",
      version: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
      items: [
        { id: "rd1-1", name: "A", normalizedName: "a", emoji: "🍚", color: "#ef4938", position: 0 },
      ],
    });
    await setupRepo.create({
      id: "ms-rd-2",
      ownerUserId: "owner-race-default",
      name: "race default 2",
      version: 1,
      createdAt: 1700000001,
      updatedAt: 1700000001,
      items: [
        { id: "rd2-1", name: "B", normalizedName: "b", emoji: "🥟", color: "#f6c84a", position: 0 },
      ],
    });
    await setupRepo.create({
      id: "ms-rd-3",
      ownerUserId: "owner-race-default",
      name: "race default 3",
      version: 1,
      createdAt: 1700000002,
      updatedAt: 1700000002,
      items: [
        { id: "rd3-1", name: "C", normalizedName: "c", emoji: "🍣", color: "#2d7a57", position: 0 },
      ],
    });

    const barrierDb = createPreReadBarrierDb(db);
    const archiveRepo = createMenuSetRepository({
      db: barrierDb,
      clock,
      idGenerator: createQueuedIdGenerator(["archive-default-race-token"]),
    });
    const setDefaultRepo = createMenuSetRepository({
      db: barrierDb,
      clock,
      idGenerator: createQueuedIdGenerator(["set-default-race-token"]),
    });
    const [archiveResult, setDefaultResult] = await Promise.all([
      archiveRepo.archiveWithFallback(
        "ms-rd-1",
        "owner-race-default",
        1,
        1700000600,
      ),
      setDefaultRepo.setDefault("ms-rd-3", "owner-race-default"),
    ]);
    assert.ok(
      archiveResult.status === "archived" || setDefaultResult.status === "updated",
    );

    const list = await setupRepo.listByOwner("owner-race-default");
    const defaults = list.filter((a) => a.menuSet.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].menuSet.id, "ms-rd-3");
    const tokenCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM menu_sets WHERE owner_user_id = ? AND write_token IS NOT NULL",
      )
      .bind("owner-race-default")
      .first<{ count: number }>();
    assert.equal(tokenCount?.count, 0);
  });

  after(async () => {
    await disposeTestD1();
  });
});
