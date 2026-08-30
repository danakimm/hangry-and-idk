import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionDraft } from "../../features/decision-history/client/decision-draft.ts";

const selected = { id: "menu-1", name: "라멘", emoji: "🍜", color: "#ef4938" };
const candidates = [
  selected,
  { id: "menu-2", name: "김밥", emoji: "🍙", color: "#2d7a57" },
];

test("decision draft snapshots menus without menu IDs and accepts an injected request ID", () => {
  const draft = createDecisionDraft(
    selected,
    candidates,
    { type: "temporary", menuSetId: null, menuSetName: null },
    "request-1",
  );
  assert.equal(draft.clientRequestId, "request-1");
  assert.deepEqual(draft.selected, {
    name: "라멘",
    emoji: "🍜",
    color: "#ef4938",
  });
  assert.equal("id" in draft.candidates[0], false);
  assert.deepEqual(draft.source, {
    type: "temporary",
    menuSetId: null,
    menuSetName: null,
  });
});

test("decision draft preserves the menu-set source snapshot", () => {
  const draft = createDecisionDraft(
    selected,
    candidates,
    { type: "menu-set", menuSetId: "set-1", menuSetName: "회사 점심" },
    "request-2",
  );
  assert.deepEqual(draft.source, {
    type: "menu-set",
    menuSetId: "set-1",
    menuSetName: "회사 점심",
  });
});
