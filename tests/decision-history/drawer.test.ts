import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import {
  createElement,
  type ComponentProps,
  type RefObject,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import type {
  DecisionHistoryResponse,
} from "../../features/decision-history/shared/contract.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
})) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
  });
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

const { default: Drawer } = await import(
  "../../features/decision-history/client/DecisionHistoryDrawer.tsx"
);

type DrawerProps = ComponentProps<typeof Drawer>;

function decision(
  id: string,
  source: DecisionHistoryResponse["source"] = {
    type: "temporary",
    menuSetId: null,
    menuSetName: null,
  },
): DecisionHistoryResponse {
  return {
    id,
    selected: { name: "라멘", emoji: "🍜", color: "#fff" },
    candidates: [
      { name: "라멘", emoji: "🍜", color: "#fff" },
      { name: "김밥", emoji: "🍙", color: "#000" },
    ],
    source,
    createdAt: 1_000,
  };
}

function makeTriggerRef(): RefObject<HTMLButtonElement | null> {
  const trigger = document.createElement("button");
  trigger.textContent = "기록";
  document.body.append(trigger);
  return { current: trigger };
}

function props(overrides: Partial<DrawerProps> = {}): DrawerProps {
  return {
    open: true,
    decisions: [decision("one")],
    status: "ready",
    error: null,
    mutationError: null,
    deletingId: null,
    deletingAll: false,
    onClose() {},
    onRetry() {},
    async onDelete() {
      return true;
    },
    async onDeleteAll() {
      return true;
    },
    triggerRef: makeTriggerRef(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

test("drawer manages initial focus, body scroll, Escape, and trigger focus restoration", () => {
  let closes = 0;
  const triggerRef = makeTriggerRef();
  triggerRef.current?.focus();
  document.body.style.overflow = "auto";
  const initial = props({
    triggerRef,
    onClose() {
      closes += 1;
    },
  });
  const view = render(createElement(Drawer, initial));

  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(
    document.activeElement,
    view.getByRole("button", { name: "결정 기록 닫기" }),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closes, 1);

  view.rerender(createElement(Drawer, { ...initial, open: false }));
  assert.equal(document.body.style.overflow, "auto");
  assert.equal(document.activeElement, triggerRef.current);
});

test("backdrop and close controls call onClose while the backdrop stays out of tab order", () => {
  let closes = 0;
  const view = render(
    createElement(
      Drawer,
      props({
        onClose() {
          closes += 1;
        },
      }),
    ),
  );
  const backdrop = view.getByRole("button", {
    name: "결정 기록 배경 닫기",
  });
  assert.equal(backdrop.getAttribute("tabindex"), "-1");
  fireEvent.click(backdrop);
  fireEvent.click(view.getByRole("button", { name: "결정 기록 닫기" }));
  assert.equal(closes, 2);
});

test("Tab and Shift+Tab remain trapped inside the dialog", () => {
  const view = render(createElement(Drawer, props()));
  const dialog = view.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  const first = buttons[0];
  const last = buttons[buttons.length - 1];

  first.focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  assert.equal(document.activeElement, last);

  last.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(document.activeElement, first);

  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(document.activeElement, first);
});

test("drawer renders loading, empty, initial error, and retained-list refresh error states", () => {
  let retries = 0;
  const base = props({
    decisions: [],
    status: "loading",
    onRetry() {
      retries += 1;
    },
  });
  const view = render(createElement(Drawer, base));
  assert.ok(view.getByLabelText("결정 기록 불러오는 중"));

  view.rerender(
    createElement(Drawer, { ...base, status: "ready" }),
  );
  assert.ok(view.getByText("아직 저장된 결정이 없어요."));

  view.rerender(
    createElement(Drawer, {
      ...base,
      status: "error",
      error: "조회 실패",
    }),
  );
  assert.ok(view.getByRole("alert").textContent?.includes("조회 실패"));
  fireEvent.click(view.getByRole("button", { name: "다시 시도" }));
  assert.equal(retries, 1);

  view.rerender(
    createElement(Drawer, {
      ...base,
      status: "ready",
      decisions: [decision("one")],
      error: "새로고침 실패",
    }),
  );
  assert.ok(view.getByRole("alert").textContent?.includes("새로고침 실패"));
  assert.ok(view.getByText("라멘"));
});

test("record cards show temporary and menu-set sources, candidates, and timestamps", () => {
  const view = render(
    createElement(
      Drawer,
      props({
        decisions: [
          decision("temporary"),
          decision("menu-set", {
            type: "menu-set",
            menuSetId: "set-1",
            menuSetName: "회사 점심",
          }),
        ],
      }),
    ),
  );
  assert.ok(view.getByText("임시 메뉴"));
  assert.ok(view.getByText("회사 점심"));
  assert.equal(view.getAllByText(/후보:/).length, 2);
  assert.match(view.getAllByText(/후보:/)[0].textContent ?? "", /라멘.*김밥/);
  assert.equal(view.container.querySelectorAll("time").length, 2);
});

test("individual deletion requires confirmation and invokes only the selected ID", async () => {
  const deleted: string[] = [];
  const view = render(
    createElement(
      Drawer,
      props({
        decisions: [decision("one"), decision("two")],
        async onDelete(id) {
          deleted.push(id);
          return true;
        },
      }),
    ),
  );
  const cards = view.container.querySelectorAll(".decision-history-card");
  fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", {
    name: "삭제",
  }));
  assert.ok(within(cards[0] as HTMLElement).getByText("삭제할까요?"));

  fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", {
    name: "취소",
  }));
  assert.equal(
    within(cards[0] as HTMLElement).queryByText("삭제할까요?"),
    null,
  );

  fireEvent.click(within(cards[1] as HTMLElement).getByRole("button", {
    name: "삭제",
  }));
  await act(async () => {
    fireEvent.click(within(cards[1] as HTMLElement).getByRole("button", {
      name: "삭제",
    }));
  });
  assert.deepEqual(deleted, ["two"]);
});

test("delete-all confirmation invokes its callback and mutation errors remain visible", async () => {
  let deletes = 0;
  const view = render(
    createElement(
      Drawer,
      props({
        mutationError: "삭제하지 못했습니다.",
        async onDeleteAll() {
          deletes += 1;
          return true;
        },
      }),
    ),
  );
  assert.ok(
    view.getByRole("alert").textContent?.includes("삭제하지 못했습니다."),
  );
  fireEvent.click(view.getByRole("button", { name: "전체 삭제" }));
  assert.ok(view.getByText("모든 기록을 삭제할까요?"));
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "전체 삭제" }));
  });
  assert.equal(deletes, 1);
});

test("all destructive controls are disabled while a mutation is active", () => {
  const view = render(
    createElement(
      Drawer,
      props({
        decisions: [decision("one"), decision("two")],
        deletingId: "one",
      }),
    ),
  );
  const destructive = [
    view.getByRole("button", { name: "전체 삭제" }),
    ...view.getAllByRole("button", { name: "삭제" }),
  ] as HTMLButtonElement[];
  assert.ok(destructive.every((button) => button.disabled));
});
