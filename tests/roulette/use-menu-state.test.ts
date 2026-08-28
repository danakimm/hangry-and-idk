import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useMenuState } from "../../features/roulette/client/useMenuState.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperty(globalThis, "window", {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, "HTMLElement", {
  value: dom.window.HTMLElement,
  configurable: true,
});

type MenuState = ReturnType<typeof useMenuState>;
let latest: MenuState | null = null;

function Harness() {
  const state = useMenuState();
  useEffect(() => {
    latest = state;
  }, [state]);
  return null;
}

function state(): MenuState {
  assert.ok(latest);
  return latest;
}

afterEach(() => {
  cleanup();
  latest = null;
});

test("replaceMenus copies archived items, assigns missing IDs, and resets the wheel", async () => {
  await act(async () => {
    render(createElement(Harness));
  });
  const previousResetKey = state().resetKey;
  const archived = [
    { id: "saved-item", name: "한식", emoji: "🍚", color: "#ef4938" },
    { id: null, name: "일식", emoji: "🍣", color: "#2d7a57" },
  ];

  await act(async () => {
    state().replaceMenus(archived);
  });

  assert.equal(state().menus.length, 2);
  assert.equal(state().menus[0]?.id, "saved-item");
  assert.ok(state().menus[1]?.id);
  assert.notEqual(state().menus[1]?.id, archived[1]?.id);
  assert.equal(state().resetKey, previousResetKey + 1);
  assert.notEqual(state().menus[0], archived[0]);
});
