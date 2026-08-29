import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  mapItemToResponse,
  mapMenuSetToResponse,
  mapMenuSetListToResponse,
} from "../../features/menu-sets/server/mapper.server.ts";
import type { MenuSetAggregate, MenuSetRecord, MenuSetItemRecord } from "../../features/menu-sets/server/model.server.ts";

describe("menu set mapper", () => {
  const mockRecord: MenuSetRecord = {
    id: "ms-001",
    ownerUserId: "owner-001",
    name: "회사 점심",
    version: 3,
    isDefault: true,
    createdAt: 1700000000,
    updatedAt: 1700000060,
    archivedAt: null,
  };

  const mockItems: MenuSetItemRecord[] = [
    { id: "item-001", menuSetId: "ms-001", name: "한식", normalizedName: "한식", emoji: "🍚", color: "#ef4938", position: 0 },
    { id: "item-002", menuSetId: "ms-001", name: "중식", normalizedName: "중식", emoji: "🥟", color: "#f6c84a", position: 1 },
  ];

  test("mapItemToResponse strips internal fields", () => {
    const result = mapItemToResponse(mockItems[0]);
    assert.equal(result.id, "item-001");
    assert.equal(result.name, "한식");
    assert.equal(result.emoji, "🍚");
    assert.equal(result.color, "#ef4938");
    assert.equal("menuSetId" in result, false);
    assert.equal("normalizedName" in result, false);
    assert.equal("position" in result, false);
  });

  test("mapMenuSetToResponse maps aggregate correctly", () => {
    const aggregate: MenuSetAggregate = { menuSet: mockRecord, items: mockItems };
    const result = mapMenuSetToResponse(aggregate);

    assert.equal(result.id, "ms-001");
    assert.equal(result.name, "회사 점심");
    assert.equal(result.version, 3);
    assert.equal(result.isDefault, true);
    assert.equal(result.createdAt, 1700000000);
    assert.equal(result.updatedAt, 1700000060);
    assert.equal(result.items.length, 2);
    assert.equal("ownerUserId" in result, false);
    assert.equal("archivedAt" in result, false);
  });

  test("mapMenuSetToResponse sorts items by position", () => {
    const unorderedItems: MenuSetItemRecord[] = [
      { id: "item-b", menuSetId: "ms-001", name: "중식", normalizedName: "중식", emoji: "🥟", color: "#f6c84a", position: 1 },
      { id: "item-a", menuSetId: "ms-001", name: "한식", normalizedName: "한식", emoji: "🍚", color: "#ef4938", position: 0 },
    ];
    const aggregate: MenuSetAggregate = { menuSet: mockRecord, items: unorderedItems };
    const result = mapMenuSetToResponse(aggregate);

    assert.equal(result.items[0].name, "한식");
    assert.equal(result.items[1].name, "중식");
  });

  test("mapMenuSetListToResponse maps list correctly", () => {
    const aggregates: MenuSetAggregate[] = [
      { menuSet: mockRecord, items: mockItems },
      {
        menuSet: { ...mockRecord, id: "ms-002", name: "주말 외식", isDefault: false },
        items: [],
      },
    ];
    const result = mapMenuSetListToResponse(aggregates);

    assert.equal(result.menuSets.length, 2);
    assert.equal(result.menuSets[0].id, "ms-001");
    assert.equal(result.menuSets[1].id, "ms-002");
  });

  test("mapMenuSetToResponse handles isDefault=false", () => {
    const record = { ...mockRecord, isDefault: false };
    const aggregate: MenuSetAggregate = { menuSet: record, items: [] };
    const result = mapMenuSetToResponse(aggregate);
    assert.equal(result.isDefault, false);
  });
});
