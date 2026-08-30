import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperty(globalThis, "window", {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
Object.defineProperty(globalThis, "HTMLElement", {
  value: dom.window.HTMLElement,
  configurable: true,
});
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    return {
      format: "module",
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const { default: RouletteResult } =
  await import("../../features/roulette/client/RouletteResult.tsx");

const selected = { id: "menu-1", name: "라멘", emoji: "🍜", color: "#ef4938" };
function props(overrides: Record<string, unknown> = {}) {
  return {
    selected,
    coordinates: null,
    restaurants: [],
    locationStatus: "idle" as const,
    restaurantStatus: "idle" as const,
    restaurantMessage: "",
    onRequestLocation: () => {},
    action: null,
    ...overrides,
  };
}
afterEach(cleanup);

test("result renders an optional feature-owned action slot", () => {
  const { rerender } = render(
    createElement(RouletteResult, props()),
  );
  assert.equal(document.body.textContent?.includes("이 메뉴로 결정"), false);
  rerender(createElement(RouletteResult, props({
    action: createElement("button", { type: "button" }, "이 메뉴로 결정"),
  })));
  assert.ok(document.body.textContent?.includes("이 메뉴로 결정"));
});

test("action slot and location action remain independent", async () => {
  let actions = 0;
  let locations = 0;
  const { rerender } = render(
    createElement(
      RouletteResult,
      props({
        action: createElement("button", {
          type: "button",
          className: "decision-recorder-action",
          onClick: () => { actions += 1; },
        }, "기록"),
        onRequestLocation: () => { locations += 1; },
      }),
    ),
  );
  fireEvent.click(document.querySelector(".decision-recorder-action")!);
  fireEvent.click(document.querySelector(".location-row button")!);
  assert.equal(actions, 1);
  assert.equal(locations, 1);
  rerender(
    createElement(
      RouletteResult,
      props({ action: createElement("small", { role: "alert" }, "offline") }),
    ),
  );
  assert.ok(document.querySelector("[role=alert]"));
  await act(async () => {});
});
