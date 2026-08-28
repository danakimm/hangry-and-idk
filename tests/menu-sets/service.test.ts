import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { MenuSetRepository } from "../../features/menu-sets/server/ports.server.ts";
import type {
  MenuSetAggregate,
} from "../../features/menu-sets/server/model.server.ts";
import { createMenuSetService } from "../../features/menu-sets/server/service.server.ts";
import type { Clock, IdGenerator } from "../../server/db/types.server.ts";

function createFakeClock(initial = 1700000000): Clock & { advance(s: number): void } {
  let current = initial;
  return {
    nowSeconds() { return current; },
    advance(s: number) { current += s; },
  };
}

function createFakeIdGenerator(): IdGenerator & { setNext(uuid: string): void } {
  let next = "fake-uuid-001";
  return {
    uuid() { return next; },
    setNext(uuid: string) { next = uuid; },
  };
}

function createFakeRepository(overrides: Partial<MenuSetRepository> = {}): MenuSetRepository {
  const store = new Map<string, MenuSetAggregate>();
  let activeCount = 0;

  return {
    async listByOwner(ownerUserId: string) {
      return [...store.values()].filter(
        (a) => a.menuSet.ownerUserId === ownerUserId && a.menuSet.archivedAt === null,
      );
    },
    async findByIdAndOwner(menuSetId: string, ownerUserId: string) {
      const agg = store.get(menuSetId);
      if (!agg || agg.menuSet.ownerUserId !== ownerUserId) return null;
      return agg;
    },
    async countActiveByOwner() {
      return activeCount;
    },
    async create(data) {
      const isDefault = ![...store.values()].some(
        (aggregate) =>
          aggregate.menuSet.ownerUserId === data.ownerUserId &&
          aggregate.menuSet.archivedAt === null &&
          aggregate.menuSet.isDefault,
      );
      const agg: MenuSetAggregate = {
        menuSet: {
          id: data.id,
          ownerUserId: data.ownerUserId,
          name: data.name,
          version: data.version,
          isDefault,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          archivedAt: null,
        },
        items: data.items.map((item) => ({
          id: item.id,
          menuSetId: data.id,
          name: item.name,
          normalizedName: item.normalizedName,
          emoji: item.emoji,
          color: item.color,
          position: item.position,
        })),
      };
      store.set(data.id, agg);
      activeCount++;
    },
    async updateAggregate(menuSetId, ownerUserId, currentVersion, input, updatedAt) {
      const agg = store.get(menuSetId);
      if (!agg || agg.menuSet.ownerUserId !== ownerUserId || agg.menuSet.archivedAt !== null) {
        return { status: "notFound" };
      }
      if (agg.menuSet.version !== currentVersion) {
        return { status: "versionConflict" };
      }
      agg.menuSet.name = input.name;
      agg.menuSet.version++;
      agg.menuSet.updatedAt = updatedAt;
      agg.items = input.items.map((item, i) => ({
        id: item.id ?? `gen-${i}`,
        menuSetId,
        name: item.name,
        normalizedName: item.normalizedName,
        emoji: item.emoji,
        color: item.color,
        position: item.position,
      }));
      return { status: "updated", aggregate: { ...agg, items: [...agg.items] } };
    },
    async archiveWithFallback(menuSetId, ownerUserId, currentVersion, archivedAt) {
      const agg = store.get(menuSetId);
      if (!agg || agg.menuSet.ownerUserId !== ownerUserId || agg.menuSet.archivedAt !== null) {
        return { status: "notFound" };
      }
      if (agg.menuSet.version !== currentVersion) {
        return { status: "versionConflict" };
      }
      agg.menuSet.archivedAt = archivedAt;
      activeCount--;
      return { status: "archived", fallbackDefaultId: null };
    },
    async setDefault(menuSetId, ownerUserId) {
      const agg = store.get(menuSetId);
      if (!agg || agg.menuSet.ownerUserId !== ownerUserId || agg.menuSet.archivedAt !== null) {
        return { status: "notFound" };
      }
      for (const a of store.values()) {
        if (a.menuSet.ownerUserId === ownerUserId) a.menuSet.isDefault = false;
      }
      agg.menuSet.isDefault = true;
      return { status: "updated" };
    },
    ...overrides,
  };
}

describe("menu_sets service (fake repository)", () => {
  test("create succeeds with valid input", async () => {
    const idGen = createFakeIdGenerator();
    const clock = createFakeClock();
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: idGen, clock });

    idGen.setNext("ms-001");
    const result = await service.create("owner-001", {
      name: "회사 점심",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.menuSet.name, "회사 점심");
      assert.equal(result.data.items.length, 2);
      assert.equal(result.data.menuSet.version, 1);
      assert.equal(result.data.menuSet.isDefault, true);
    }
  });

  test("create rejects invalid name", async () => {
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: createFakeIdGenerator(), clock: createFakeClock() });

    const result = await service.create("owner-001", {
      name: "",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MENU_SET");
  });

  test("create rejects fewer than 2 items", async () => {
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: createFakeIdGenerator(), clock: createFakeClock() });

    const result = await service.create("owner-001", {
      name: "테스트",
      items: [{ id: null, name: "한식", emoji: "🍚", color: "#ef4938" }],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MENU_SET");
  });

  test("create rejects duplicate item names", async () => {
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: createFakeIdGenerator(), clock: createFakeClock() });

    const result = await service.create("owner-001", {
      name: "테스트",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "한식 ", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MENU_SET");
  });

  test("service error has no HTTP status", async () => {
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: createFakeIdGenerator(), clock: createFakeClock() });

    const result = await service.get("nonexistent", "owner-001");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal("status" in result.error, false);
      assert.equal(result.error.code, "MENU_SET_NOT_FOUND");
    }
  });

  test("update fails with stale version", async () => {
    const idGen = createFakeIdGenerator();
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: idGen, clock: createFakeClock() });

    idGen.setNext("ms-001");
    await service.create("owner-001", {
      name: "테스트",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    const result = await service.update("ms-001", "owner-001", {
      version: 999,
      name: "stale",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "MENU_SET_VERSION_CONFLICT");
  });

  test("update rejects an item id that does not belong to the menu set", async () => {
    const idGen = createFakeIdGenerator();
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: idGen, clock: createFakeClock() });

    idGen.setNext("ms-item-owner");
    const created = await service.create("owner-item-validation", {
      name: "테스트",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });
    assert.equal(created.ok, true);

    const result = await service.update("ms-item-owner", "owner-item-validation", {
      version: 1,
      name: "테스트",
      items: [
        { id: "forged-item-id", name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MENU_SET");
  });

  test("update rejects a duplicated existing item id", async () => {
    const idGen = createFakeIdGenerator();
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: idGen, clock: createFakeClock() });

    idGen.setNext("ms-duplicate-item");
    const created = await service.create("owner-duplicate-item", {
      name: "테스트",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });
    assert.equal(created.ok, true);
    if (!created.ok) assert.fail("Expected menu set creation to succeed");
    const existingItemId = created.data.items[0].id;

    const result = await service.update("ms-duplicate-item", "owner-duplicate-item", {
      version: 1,
      name: "테스트",
      items: [
        { id: existingItemId, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: existingItemId, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_MENU_SET");
  });

  test("archive fails with stale version", async () => {
    const idGen = createFakeIdGenerator();
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: idGen, clock: createFakeClock() });

    idGen.setNext("ms-001");
    await service.create("owner-001", {
      name: "테스트",
      items: [
        { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
        { id: null, name: "중식", emoji: "🥟", color: "#f6c84a" },
      ],
    });

    const result = await service.archive("ms-001", "owner-001", { version: 999 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "MENU_SET_VERSION_CONFLICT");
  });

  test("service does not depend on D1 types", async () => {
    const repo = createFakeRepository();
    const service = createMenuSetService({ repository: repo, idGenerator: createFakeIdGenerator(), clock: createFakeClock() });
    assert.ok(service);
  });
});
