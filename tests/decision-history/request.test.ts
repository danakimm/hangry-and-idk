import assert from "node:assert/strict";
import test from "node:test";
import { validateAndNormalizeDecision } from "../../features/decision-history/server/validation.server.ts";

const valid = {
  clientRequestId: "request-1",
  selected: { name: "라멘", emoji: "🍜", color: "#112233" },
  candidates: [{ name: "라멘", emoji: "🍜", color: "#112233" }, { name: "김밥", emoji: "🍚", color: "#445566" }],
  source: { type: "temporary", menuSetId: null, menuSetName: null },
};

test("decision history request parser normalizes only the public command shape", () => {
  const parsed = validateAndNormalizeDecision({ ...valid, ownerUserId: "forged", createdAt: 1 });
  assert.deepEqual(parsed, { ok: true, command: valid });
  for (const invalid of [null, [], { ...valid, selected: null }, { ...valid, candidates: [{}] }, { ...valid, source: { type: "temporary", menuSetId: "bad", menuSetName: null } }]) {
    assert.equal(validateAndNormalizeDecision(invalid).ok, false);
  }
});
