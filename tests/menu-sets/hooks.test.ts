import assert from "node:assert/strict";
import test, { afterEach, beforeEach, describe } from "node:test";
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import {
  AuthContext,
  type AuthContextValue,
} from "../../features/auth/client/context.ts";
import {
  useMenuSets,
  type UseMenuSetsReturn,
} from "../../features/menu-sets/client/hooks.ts";
import type {
  MenuSetApiClient,
  MenuSetApiResult,
} from "../../features/menu-sets/client/api.ts";
import type { MenuSetResponse } from "../../features/menu-sets/shared/contract.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://hangry-and-idk.test/",
});
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

const baseMenuSet: MenuSetResponse = {
  id: "set-1",
  name: "회사 점심",
  version: 1,
  isDefault: true,
  createdAt: 1000,
  updatedAt: 1000,
  items: [
    { id: "item-1", name: "한식", emoji: "🍚", color: "#ef4938" },
    { id: "item-2", name: "일식", emoji: "🍣", color: "#2d7a57" },
  ],
};

const secondaryMenuSet: MenuSetResponse = {
  ...baseMenuSet,
  id: "set-2",
  name: "저녁 후보",
  isDefault: false,
  items: baseMenuSet.items.map((item, index) => ({
    ...item,
    id: `secondary-item-${index + 1}`,
  })),
};

function successfulApi(
  overrides: Partial<MenuSetApiClient> = {},
): MenuSetApiClient {
  return {
    async fetchMenuSets() {
      return { ok: true, data: { menuSets: [baseMenuSet] } };
    },
    async fetchMenuSet() {
      return { ok: true, data: baseMenuSet };
    },
    async createMenuSet() {
      return { ok: true, data: baseMenuSet };
    },
    async updateMenuSet(_id, input) {
      return {
        ok: true,
        data: {
          ...baseMenuSet,
          name: input.name,
          version: input.version + 1,
          items: input.items.map((item, index) => ({
            id: item.id ?? `created-${index}`,
            name: item.name,
            emoji: item.emoji,
            color: item.color,
          })),
        },
      };
    },
    async deleteMenuSet() {
      return { ok: true };
    },
    async setDefaultMenuSet() {
      return { ok: true, data: baseMenuSet };
    },
    ...overrides,
  };
}

function authValue(
  enabled: boolean,
  registerCleanup: (callback: () => void) => void,
): AuthContextValue {
  return {
    user: { email: "user@example.com", name: "User" },
    status: "authenticated",
    menuSetsEnabled: enabled,
    interactiveLoginVersion: 0,
    async login() {},
    async logout() {},
    async refreshSession() {},
    onLogoutCleanup(callback) {
      registerCleanup(callback);
      return () => {};
    },
  };
}

let latest: UseMenuSetsReturn | null = null;

function Harness({ api }: { api: MenuSetApiClient }) {
  const value = useMenuSets(api);
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

async function renderHook(
  api: MenuSetApiClient,
  enabled = true,
): Promise<{ cleanup: () => void }> {
  let cleanup = () => {};
  await act(async () => {
    render(
      createElement(
        AuthContext.Provider,
        {
          value: authValue(enabled, (callback) => {
            cleanup = callback;
          }),
        },
        createElement(Harness, { api }),
      ),
    );
  });
  return { cleanup };
}

function state(): UseMenuSetsReturn {
  assert.ok(latest);
  return latest;
}

describe("useMenuSets", () => {
  beforeEach(() => {
    latest = null;
  });

  afterEach(async () => {
    cleanup();
  });

  test("feature flag off neither loads nor exposes user menu data", async () => {
    let fetchCount = 0;
    await renderHook(successfulApi({
      async fetchMenuSets() {
        fetchCount += 1;
        return { ok: true, data: { menuSets: [baseMenuSet] } };
      },
    }), false);

    assert.equal(fetchCount, 0);
    assert.equal(state().menuSets.length, 0);
    assert.equal(state().currentMenuSet, null);
  });

  test("draft changes immediately and does not save after 700ms", async () => {
    let updateCount = 0;
    await renderHook(successfulApi({
      async updateMenuSet() {
        updateCount += 1;
        return {
          ok: true,
          data: { ...baseMenuSet, version: 2 },
        };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      state().updateDraft("새 이름", state().draftItems);
    });
    assert.equal(state().draftName, "새 이름");
    assert.equal(state().saveStatus, "dirty");
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(updateCount, 0);
  });

  test("save button sends PUT exactly once with current draft", async () => {
    const calls: { version: number; name: string }[] = [];
    await renderHook(successfulApi({
      async updateMenuSet(_id, input) {
        calls.push({ version: input.version, name: input.name });
        return {
          ok: true,
          data: { ...baseMenuSet, ...input, version: input.version + 1 },
        } as MenuSetApiResult;
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      state().updateDraft("저장 테스트", state().draftItems);
    });
    assert.equal(state().saveStatus, "dirty");

    let saved = false;
    await act(async () => {
      saved = await state().saveCurrent();
    });
    assert.equal(saved, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { version: 1, name: "저장 테스트" });
    assert.equal(state().saveStatus, "saved");
  });

  test("save uses response version for next PUT", async () => {
    const calls: { version: number; name: string }[] = [];
    await renderHook(successfulApi({
      async updateMenuSet(_id, input) {
        calls.push({ version: input.version, name: input.name });
        return {
          ok: true,
          data: { ...baseMenuSet, ...input, version: input.version + 1 },
        } as MenuSetApiResult;
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      state().updateDraft("첫 저장", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { version: 1, name: "첫 저장" });

    await act(async () => {
      state().updateDraft("두 번째 저장", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { version: 2, name: "두 번째 저장" });
  });

  test("isMutating blocks duplicate save during in-flight request", async () => {
    let resolveFirst!: (result: MenuSetApiResult) => void;
    const first = new Promise<MenuSetApiResult>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    let createCount = 0;
    let archiveCount = 0;
    let defaultCount = 0;
    let reloadCount = 0;
    const api = successfulApi({
      async updateMenuSet(_id, input) {
        callCount += 1;
        if (callCount === 1) return first;
        return {
          ok: true,
          data: { ...baseMenuSet, ...input, version: input.version + 1 },
        } as MenuSetApiResult;
      },
      async createMenuSet() {
        createCount += 1;
        return { ok: true, data: secondaryMenuSet };
      },
      async deleteMenuSet() {
        archiveCount += 1;
        return { ok: true };
      },
      async setDefaultMenuSet() {
        defaultCount += 1;
        return { ok: true, data: baseMenuSet };
      },
      async fetchMenuSet() {
        reloadCount += 1;
        return { ok: true, data: baseMenuSet };
      },
    });
    await renderHook(api);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      state().updateDraft("first", state().draftItems);
      void state().saveCurrent();
    });
    assert.equal(state().isMutating, true);

    await act(async () => {
      await state().saveCurrent();
    });
    assert.equal(callCount, 1);

    await act(async () => {
      assert.equal(await state().createNew("duplicate", state().draftItems), false);
      assert.equal(await state().archiveCurrent(), false);
      assert.equal(await state().setDefault(), false);
      assert.equal(await state().reloadConflict(), false);
      state().updateDraft("blocked edit", state().draftItems);
    });
    assert.equal(createCount, 0);
    assert.equal(archiveCount, 0);
    assert.equal(defaultCount, 0);
    assert.equal(reloadCount, 0);
    assert.equal(state().draftName, "first");

    await act(async () => {
      resolveFirst({
        ok: true,
        data: { ...baseMenuSet, name: "first", version: 2 },
      });
      await first;
    });
    assert.equal(state().isMutating, false);
  });

  test("network failure keeps draft and retry with same button", async () => {
    let attempts = 0;
    await renderHook(successfulApi({
      async updateMenuSet(_id, input) {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            failure: "network",
            error: {
              error: { code: "INTERNAL_ERROR", message: "offline" },
            },
          };
        }
        return {
          ok: true,
          data: { ...baseMenuSet, name: input.name, version: 2 },
        };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    let saved = true;
    await act(async () => {
      state().updateDraft("offline draft", state().draftItems);
      saved = await state().saveCurrent();
    });
    assert.equal(saved, false);
    assert.equal(state().saveStatus, "offline");
    assert.equal(state().draftName, "offline draft");

    await act(async () => {
      saved = await state().saveCurrent();
    });
    assert.equal(saved, true);
    assert.equal(attempts, 2);
    assert.equal(state().saveStatus, "saved");
  });

  test("HTTP save failure keeps the draft dirty", async () => {
    await renderHook(successfulApi({
      async updateMenuSet() {
        return {
          ok: false,
          failure: "http",
          error: {
            error: { code: "INTERNAL_ERROR", message: "save failed" },
          },
        };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state().selectMenuSet("set-1");
      state().updateDraft("unsaved draft", state().draftItems);
      await state().saveCurrent();
    });

    assert.equal(state().saveStatus, "dirty");
    assert.equal(state().draftName, "unsaved draft");
    assert.equal(state().error, "save failed");
  });

  test("conflict keeps draft and reload replaces it", async () => {
    const latestServer = {
      ...baseMenuSet,
      name: "server latest",
      version: 2,
    };
    await renderHook(successfulApi({
      async updateMenuSet() {
        return {
          ok: false,
          failure: "http",
          error: {
            error: {
              code: "MENU_SET_VERSION_CONFLICT",
              message: "conflict",
            },
          },
        };
      },
      async fetchMenuSet() {
        return { ok: true, data: latestServer };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      state().updateDraft("my local draft", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(state().saveStatus, "conflict");
    assert.equal(state().draftName, "my local draft");

    await act(async () => {
      const result = await state().reloadConflict();
      assert.equal(result, true);
    });
    assert.equal(state().saveStatus, "idle");
    assert.equal(state().draftName, "server latest");
    assert.equal(state().currentMenuSet?.version, 2);
  });

  test("failed conflict reload keeps the conflict and local draft", async () => {
    await renderHook(successfulApi({
      async updateMenuSet() {
        return {
          ok: false,
          failure: "http",
          error: {
            error: {
              code: "MENU_SET_VERSION_CONFLICT",
              message: "conflict",
            },
          },
        };
      },
      async fetchMenuSet() {
        return {
          ok: false,
          failure: "network",
          error: {
            error: { code: "INTERNAL_ERROR", message: "reload failed" },
          },
        };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state().selectMenuSet("set-1");
      state().updateDraft("local conflict draft", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(state().saveStatus, "conflict");

    await act(async () => {
      assert.equal(await state().reloadConflict(), false);
    });
    assert.equal(state().saveStatus, "conflict");
    assert.equal(state().draftName, "local conflict draft");
    assert.equal(state().error, "reload failed");
  });

  test("archive refreshes the fallback default and clears selection", async () => {
    let fetchCount = 0;
    const fallbackDefault = { ...secondaryMenuSet, isDefault: true, version: 2 };
    await renderHook(successfulApi({
      async fetchMenuSets() {
        fetchCount += 1;
        return {
          ok: true,
          data: {
            menuSets: fetchCount === 1
              ? [baseMenuSet, secondaryMenuSet]
              : [fallbackDefault],
          },
        };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 2);
    assert.equal(state().currentMenuSet, null);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    await act(async () => {
      const result = await state().archiveCurrent();
      assert.equal(result, true);
    });
    assert.equal(state().currentMenuSet, null);
    assert.equal(state().draftItems.length, 0);
    assert.equal(fetchCount, 2);
    assert.deepEqual(state().menuSets, [fallbackDefault]);
  });

  test("setDefault refreshes flags without replacing a dirty draft", async () => {
    let fetchCount = 0;
    const updatedDefault = { ...secondaryMenuSet, isDefault: true, version: 2 };
    await renderHook(successfulApi({
      async fetchMenuSets() {
        fetchCount += 1;
        return {
          ok: true,
          data: {
            menuSets: fetchCount === 1
              ? [baseMenuSet, secondaryMenuSet]
              : [{ ...baseMenuSet, isDefault: false }, updatedDefault],
          },
        };
      },
      async setDefaultMenuSet() {
        return { ok: true, data: updatedDefault };
      },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state().selectMenuSet("set-2");
      state().updateDraft("dirty default draft", state().draftItems);
      assert.equal(await state().setDefault(), true);
    });

    assert.equal(state().currentMenuSet?.isDefault, true);
    assert.equal(state().draftName, "dirty default draft");
    assert.equal(state().saveStatus, "dirty");
    assert.equal(fetchCount, 2);
  });

  test("resetCurrentDraft restores server version", async () => {
    await renderHook(successfulApi());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);
    assert.equal(state().currentMenuSet, null);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");
    assert.equal(state().draftName, "회사 점심");

    await act(async () => {
      state().updateDraft("modified", state().draftItems);
    });
    assert.equal(state().draftName, "modified");
    assert.equal(state().saveStatus, "dirty");

    await act(async () => {
      state().resetCurrentDraft();
    });
    assert.equal(state().draftName, "회사 점심");
    assert.equal(state().saveStatus, "idle");
  });

  test("logout aborts requests and ignores a late successful response", async () => {
    let updateSignal: AbortSignal | undefined;
    let resolveUpdate!: (result: MenuSetApiResult) => void;
    const pendingUpdate = new Promise<MenuSetApiResult>((resolve) => {
      resolveUpdate = resolve;
    });
    const api = successfulApi({
      updateMenuSet(_id, _input, signal) {
        updateSignal = signal;
        return pendingUpdate;
      },
    });
    const { cleanup } = await renderHook(api);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(state().menuSets.length, 1);
    assert.equal(state().currentMenuSet, null);

    await act(async () => {
      state().selectMenuSet("set-1");
    });
    assert.equal(state().currentMenuSet?.id, "set-1");

    let savePromise!: Promise<boolean>;
    await act(async () => {
      state().updateDraft("will abort", state().draftItems);
      savePromise = state().saveCurrent();
    });
    assert.equal(updateSignal?.aborted, false);

    await act(async () => cleanup());
    assert.equal(updateSignal?.aborted, true);
    assert.equal(state().menuSets.length, 0);
    assert.equal(state().draftItems.length, 0);

    await act(async () => {
      resolveUpdate({
        ok: true,
        data: { ...baseMenuSet, name: "late response", version: 2 },
      });
      await savePromise;
    });
    assert.equal(state().menuSets.length, 0);
    assert.equal(state().draftItems.length, 0);
  });
});
