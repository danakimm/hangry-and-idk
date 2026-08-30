import assert from "node:assert/strict";
import test from "node:test";
import { mapDecisionHistoryToResponse } from "../../features/decision-history/server/mapper.server.ts";

test("decision history mapper excludes ownership and idempotency internals", () => {
  const response = mapDecisionHistoryToResponse({
    id: "decision",
    ownerUserId: "owner",
    clientRequestId: "request",
    createdAt: 123,
    selected: { name: "라멘", emoji: "🍜", color: "#112233" },
    candidates: [{ name: "라멘", emoji: "🍜", color: "#112233" }],
    source: { type: "temporary", menuSetId: null, menuSetName: null },
  });
  assert.deepEqual(response, {
    id: "decision",
    createdAt: 123_000,
    selected: { name: "라멘", emoji: "🍜", color: "#112233" },
    candidates: [{ name: "라멘", emoji: "🍜", color: "#112233" }],
    source: { type: "temporary", menuSetId: null, menuSetName: null },
  });
  assert.doesNotMatch(JSON.stringify(response), /owner|clientRequest/i);
});
