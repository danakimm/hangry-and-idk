import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import {
  AuthContext,
  type AuthContextValue,
} from "../../features/auth/client/context.ts";
import type {
  DecisionHistoryApiClient,
  DecisionHistoryCreateApiClient,
} from "../../features/decision-history/client/api.ts";
import type { DecisionDraft } from "../../features/decision-history/client/decision-draft.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
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
const { default: DecisionRecorder } = await import(
  "../../features/decision-history/client/DecisionRecorder.tsx"
);
const { default: DecisionHistoryPanel } = await import(
  "../../features/decision-history/client/DecisionHistoryPanel.tsx"
);

const draft: DecisionDraft = {
  clientRequestId: "request-1",
  selected: { name: "라멘", emoji: "🍜", color: "#ef4938" },
  candidates: [
    { name: "라멘", emoji: "🍜", color: "#ef4938" },
    { name: "김밥", emoji: "🍙", color: "#2d7a57" },
  ],
  source: { type: "temporary", menuSetId: null, menuSetName: null },
};

function auth(
  status: AuthContextValue["status"] = "authenticated",
  decisionHistoryEnabled = true,
): AuthContextValue {
  return {
    user: status === "authenticated" ? { email: "a@b.c", name: "A" } : null,
    status,
    menuSetsEnabled: false,
    decisionHistoryEnabled,
    interactiveLoginVersion: 0,
    async login() {},
    async logout() {},
    async refreshSession() {},
    onLogoutCleanup() { return () => {}; },
  };
}

function withAuth(node: React.ReactElement, value = auth()) {
  return createElement(AuthContext.Provider, { value }, node);
}

afterEach(cleanup);

test("DecisionRecorder owns authenticated save states and anonymous guidance", async () => {
  let saves = 0;
  let saved = 0;
  const api = {
    async createDecision() {
      saves += 1;
      return {
        ok: true as const,
        data: {
          created: true,
          decision: { id: "d1", selected: draft.selected, candidates: draft.candidates, source: draft.source, createdAt: 1 },
        },
      };
    },
  } as DecisionHistoryCreateApiClient;
  const view = render(withAuth(createElement(DecisionRecorder, {
    draft,
    apiClient: api,
    onSaved: () => { saved += 1; },
  })));
  fireEvent.click(view.getByRole("button", { name: "이 메뉴로 결정" }));
  await act(async () => {});
  assert.equal(saves, 1);
  assert.equal(saved, 1);
  assert.ok(view.getByRole("button", { name: "결정 기록 완료 ✓" }).hasAttribute("disabled"));

  view.rerender(withAuth(createElement(DecisionRecorder, { draft, apiClient: api }), auth("anonymous")));
  assert.ok(view.getByText("로그인하면 결정을 기록할 수 있어요"));
});

test("DecisionHistoryPanel connects its trigger, drawer, and refresh token", async () => {
  let requests = 0;
  const api = {
    async listDecisions() {
      requests += 1;
      return { ok: true as const, data: { decisions: [] } };
    },
    async createDecision() { throw new Error("not used"); },
    async deleteDecision() { throw new Error("not used"); },
    async deleteAllDecisions() { throw new Error("not used"); },
  } as DecisionHistoryApiClient;
  const view = render(withAuth(createElement(DecisionHistoryPanel, { refreshToken: 0, apiClient: api })));
  fireEvent.click(view.getByRole("button", { name: "결정 기록 열기" }));
  await act(async () => {});
  assert.ok(view.getByRole("dialog", { name: "결정 기록" }));
  assert.equal(requests, 1);
  view.rerender(withAuth(createElement(DecisionHistoryPanel, { refreshToken: 1, apiClient: api })));
  await act(async () => {});
  assert.equal(requests, 2);
});
