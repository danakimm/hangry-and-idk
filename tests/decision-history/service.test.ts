import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createDecisionHistoryService } from "../../features/decision-history/server/service.server.ts";
import type { CreateDecisionCommand, DecisionHistoryRecord } from "../../features/decision-history/server/model.server.ts";
import type { DecisionHistoryRepository } from "../../features/decision-history/server/ports.server.ts";

const command = (): CreateDecisionCommand => ({
  clientRequestId: " request-1 ", selected: { name: " 라멘 ", emoji: "🍜", color: "#112233" },
  candidates: [{ name: " 라멘 ", emoji: "🍜", color: "#112233" }, { name: "김  밥", emoji: "🍚", color: "#445566" }],
  source: { type: "menu-set", menuSetId: "ms1", menuSetName: " 회사  점심 " },
});

function harness(overrides: Partial<DecisionHistoryRepository> = {}) {
  let calls = 0; let stored: DecisionHistoryRecord | null = null;
  const repository: DecisionHistoryRepository = {
    async createOrGet(record) { calls++; stored = record; return { record, created: true }; },
    async listByOwner() { return stored ? [stored] : []; },
    async deleteByIdAndOwner() { return false; }, async deleteAllByOwner() { return 2; }, ...overrides,
  };
  const service = createDecisionHistoryService({ repository, idGenerator: { uuid: () => "generated-id" }, clock: { nowSeconds: () => 123 } });
  return { service, calls: () => calls, stored: () => stored };
}

describe("decision history service", () => {
  test("normalizes and creates with injected ID and clock", async () => {
    const h = harness(); const result = await h.service.create("owner", command());
    assert.equal(result.ok, true); assert.equal(h.stored()?.id, "generated-id"); assert.equal(h.stored()?.createdAt, 123);
    assert.equal(h.stored()?.clientRequestId, "request-1"); assert.equal(h.stored()?.selected.name, "라멘");
    assert.equal(h.stored()?.candidates[1].name, "김 밥"); assert.equal(h.stored()?.source.menuSetName, "회사 점심");
  });

  test("rejects invalid candidates, snapshots, and sources before repository", async () => {
    const cases: CreateDecisionCommand[] = [
      { ...command(), candidates: [command().candidates[0]] },
      { ...command(), candidates: [command().candidates[0], { ...command().candidates[0], name: "라멘" }] },
      { ...command(), candidates: [{ ...command().candidates[0], emoji: "x" }, command().candidates[1]] },
      { ...command(), candidates: [{ ...command().candidates[0], color: "red" }, command().candidates[1]] },
      { ...command(), selected: { ...command().selected, color: "#ffffff" } },
      { ...command(), source: { type: "temporary", menuSetId: "bad", menuSetName: null } as never },
    ];
    const h = harness();
    for (const invalid of cases) { const result = await h.service.create("owner", invalid); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "INVALID_DECISION_HISTORY"); }
    assert.equal(h.calls(), 0);
  });

  test("rejects malformed runtime input without throwing", async () => {
    const tooMany = Array.from({ length: 11 }, (_, index) => ({
      name: `메뉴${index}`,
      emoji: "🍚",
      color: "#112233",
    }));
    const cases: unknown[] = [
      null,
      { ...command(), clientRequestId: " " },
      { ...command(), clientRequestId: "x".repeat(129) },
      { ...command(), selected: null },
      { ...command(), selected: { name: 1, emoji: "🍜", color: "#112233" } },
      { ...command(), candidates: [null, command().candidates[1]] },
      { ...command(), candidates: [{ name: "A", emoji: 1, color: "#112233" }, command().candidates[1]] },
      { ...command(), candidates: tooMany },
      { ...command(), candidates: [{ ...command().candidates[0], name: "x".repeat(13) }, command().candidates[1]] },
      { ...command(), source: null },
      { ...command(), source: { type: "menu-set", menuSetId: 1, menuSetName: "Set" } },
      { ...command(), source: { type: "menu-set", menuSetId: "x".repeat(129), menuSetName: "Set" } },
      { ...command(), source: { type: "menu-set", menuSetId: "id", menuSetName: 1 } },
      { ...command(), source: { type: "menu-set", menuSetId: "id", menuSetName: "x".repeat(31) } },
    ];
    const h = harness();
    for (const invalid of cases) {
      const result = await h.service.create(
        "owner",
        invalid as CreateDecisionCommand,
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_DECISION_HISTORY");
      }
    }
    assert.equal(h.calls(), 0);
  });

  test("returns idempotent success and maps repository errors", async () => {
    const prior = { ...({} as DecisionHistoryRecord), id: "prior" };
    const retry = harness({ async createOrGet() { return { record: prior, created: false }; } });
    const result = await retry.service.create("owner", command()); assert.equal(result.ok, true); if (result.ok) assert.equal(result.data.created, false);
    const broken = harness({ async createOrGet() { throw new Error("db"); }, async listByOwner() { throw new Error("db"); }, async deleteAllByOwner() { throw new Error("db"); } });
    for (const result of [await broken.service.create("owner", command()), await broken.service.list("owner"), await broken.service.deleteAll("owner")]) {
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "INTERNAL_ERROR");
    }
  });

  test("maps missing and other-owner deletion to not found", async () => {
    const h = harness({ async deleteByIdAndOwner() { return false; } }); const result = await h.service.deleteOne("id", "other");
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DECISION_HISTORY_NOT_FOUND");
    const deleted = await h.service.deleteAll("owner"); assert.deepEqual(deleted, { ok: true, data: { deletedCount: 2 } });
  });

  test("maps delete repository errors to internal error", async () => {
    const h = harness({
      async deleteByIdAndOwner() {
        throw new Error("db");
      },
    });
    const result = await h.service.deleteOne("id", "owner");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INTERNAL_ERROR");
  });
});
