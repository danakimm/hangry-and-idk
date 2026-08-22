import assert from "node:assert/strict";
import test from "node:test";
import {
  applyResetTransition,
  applySubmitTransition,
  type MenuEditorFormState,
} from "../../features/roulette/client/menu-editor-state.ts";

test("applyResetTransition keeps input text", () => {
  const current: MenuEditorFormState = {
    inputText: "쌀국수",
    emoji: "🍜",
    isPickerOpen: true,
  };

  const next = applyResetTransition(current);

  assert.equal(next.inputText, "쌀국수");
});

test("applyResetTransition restores default emoji", () => {
  const current: MenuEditorFormState = {
    inputText: "",
    emoji: "🍜",
    isPickerOpen: false,
  };

  const next = applyResetTransition(current);

  assert.equal(next.emoji, "🍽️");
});

test("applyResetTransition closes picker", () => {
  const current: MenuEditorFormState = {
    inputText: "",
    emoji: "🍽️",
    isPickerOpen: true,
  };

  const next = applyResetTransition(current);

  assert.equal(next.isPickerOpen, false);
});

test("applyResetTransition preserves all fields correctly together", () => {
  const current: MenuEditorFormState = {
    inputText: "피자",
    emoji: "🍕",
    isPickerOpen: true,
  };

  const next = applyResetTransition(current);

  assert.deepStrictEqual(next, {
    inputText: "피자",
    emoji: "🍽️",
    isPickerOpen: false,
  });
});

test("applySubmitTransition clears input text", () => {
  const next = applySubmitTransition();

  assert.equal(next.inputText, "");
});

test("applySubmitTransition restores default emoji", () => {
  const next = applySubmitTransition();

  assert.equal(next.emoji, "🍽️");
});

test("applySubmitTransition closes picker", () => {
  const next = applySubmitTransition();

  assert.equal(next.isPickerOpen, false);
});

test("applySubmitTransition returns complete reset state", () => {
  const next = applySubmitTransition();

  assert.deepStrictEqual(next, {
    inputText: "",
    emoji: "🍽️",
    isPickerOpen: false,
  });
});
