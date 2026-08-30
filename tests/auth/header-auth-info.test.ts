import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { createElement, type ReactNode } from "react";
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
Object.defineProperty(globalThis, "Node", {
  value: dom.window.Node,
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

const { AuthContext } = await import("../../features/auth/client/context.ts");
const { default: UserMenu } =
  await import("../../features/auth/client/UserMenu.tsx");
const { default: DecisionHistoryTrigger } = await import(
  "../../features/decision-history/client/DecisionHistoryTrigger.tsx"
);

type AuthOverrides = Partial<React.ContextType<typeof AuthContext>>;

function authValue(overrides: AuthOverrides = {}) {
  return {
    user: null,
    status: "anonymous" as const,
    menuSetsEnabled: true,
    decisionHistoryEnabled: true,
    interactiveLoginVersion: 0,
    login: async () => {},
    logout: async () => {},
    refreshSession: async () => {},
    onLogoutCleanup: () => () => {},
    ...overrides,
  };
}

function withAuth(children: ReactNode, overrides: AuthOverrides = {}) {
  return createElement(
    AuthContext.Provider,
    { value: authValue(overrides) },
    children,
  );
}

afterEach(cleanup);

test("anonymous menu places the benefits control immediately after Google login", () => {
  const view = render(withAuth(createElement(UserMenu)));
  const buttons = view.getAllByRole("button");
  assert.equal(buttons[0]?.getAttribute("aria-label"), "Google 로그인");
  assert.equal(buttons[1]?.getAttribute("aria-label"), "로그인 혜택 안내");
});

test("authenticated and loading user menu states preserve user actions", () => {
  const view = render(withAuth(createElement(UserMenu), {
    user: { name: "긴 사용자 이름", email: "person@example.com" },
    status: "authenticated",
  }));
  assert.ok(view.getByText("긴 사용자 이름"));
  assert.ok(view.getByRole("button", { name: "로그아웃" }));
  assert.equal(view.queryByLabelText("로그인 혜택 안내"), null);
  view.rerender(withAuth(createElement(UserMenu), { status: "loading" }));
  assert.ok(document.querySelector(".user-menu-loading"));
});

test("benefits tooltip supports click, outside click, Escape, and flag-specific copy", () => {
  const view = render(withAuth(createElement(UserMenu)));
  const trigger = view.getByRole("button", { name: "로그인 혜택 안내" });
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const tooltip = view.getByRole("tooltip");
  assert.equal(trigger.getAttribute("aria-describedby"), tooltip.id);
  assert.ok(view.getByText("메뉴판 저장 및 불러오기"));
  assert.ok(view.getByText("최근 결정 기록 최대 10개 보관"));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(view.queryByRole("tooltip"), null);
  assert.equal(document.activeElement, trigger);
  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  assert.equal(view.queryByRole("tooltip"), null);

  view.rerender(withAuth(createElement(UserMenu), { decisionHistoryEnabled: false }));
  fireEvent.click(view.getByRole("button", { name: "로그인 혜택 안내" }));
  assert.ok(view.getByText("메뉴판 저장 및 불러오기"));
  assert.equal(view.queryByText("최근 결정 기록 최대 10개 보관"), null);
  view.rerender(withAuth(createElement(UserMenu), { menuSetsEnabled: false, decisionHistoryEnabled: false }));
  assert.equal(view.queryByLabelText("로그인 혜택 안내"), null);
  view.rerender(withAuth(createElement(UserMenu)));
  assert.equal(view.queryByRole("tooltip"), null);
});

test("login and logout callbacks remain wired", async () => {
  let loginCount = 0;
  let logoutCount = 0;
  const view = render(withAuth(createElement(UserMenu), {
    login: async () => { loginCount += 1; },
  }));
  fireEvent.click(view.getByRole("button", { name: "Google 로그인" }));
  await act(async () => {});
  assert.equal(loginCount, 1);
  view.rerender(withAuth(createElement(UserMenu), {
    user: { name: "사용자", email: null },
    status: "authenticated",
    logout: async () => { logoutCount += 1; },
  }));
  fireEvent.click(view.getByRole("button", { name: "로그아웃" }));
  await act(async () => {});
  assert.equal(logoutCount, 1);
});

test("decision-history trigger is feature-gated and cannot become a dead click", () => {
  const view = render(withAuth(createElement(DecisionHistoryTrigger), {
    decisionHistoryEnabled: false,
  }));
  assert.equal(view.queryByRole("button", { name: "결정 기록 열기" }), null);
  view.rerender(
    withAuth(createElement(DecisionHistoryTrigger, { disabled: false })),
  );
  const noHandlerTrigger = view.getByRole("button", {
    name: "결정 기록 열기",
  }) as HTMLButtonElement;
  assert.equal(noHandlerTrigger.disabled, true);

  let opens = 0;
  view.rerender(
    withAuth(
      createElement(DecisionHistoryTrigger, {
        disabled: false,
        onOpen: () => {
          opens += 1;
        },
      }),
      { status: "authenticated" },
    ),
  );
  const activeTrigger = view.getByRole("button", {
    name: "결정 기록 열기",
  }) as HTMLButtonElement;
  assert.equal(activeTrigger.disabled, false);
  assert.ok(view.getByText("결정 기록"));
  fireEvent.click(activeTrigger);
  assert.equal(opens, 1);
});
