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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

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
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    latest = null;
  });

  afterEach(async () => {
    cleanup();
    Reflect.deleteProperty(globalThis, "localStorage");
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

  test("draft changes immediately and save after a 700ms debounce", async () => {
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
      state().updateDraft("즉시 반영", state().draftItems);
    });
    assert.equal(state().draftName, "즉시 반영");
    assert.equal(state().saveStatus, "dirty");

    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(calls.length, 0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { version: 1, name: "즉시 반영" });
  });

  test("a pending draft uses the successful response version", async () => {
    let resolveFirst!: (result: MenuSetApiResult) => void;
    const first = new Promise<MenuSetApiResult>((resolve) => {
      resolveFirst = resolve;
    });
    const calls: { version: number; name: string }[] = [];
    const api = successfulApi({
      async updateMenuSet(_id, input) {
        calls.push({ version: input.version, name: input.name });
        if (calls.length === 1) return first;
        return {
          ok: true,
          data: { ...baseMenuSet, ...input, version: input.version + 1 },
        } as MenuSetApiResult;
      },
    });
    await renderHook(api);

    await act(async () => {
      state().updateDraft("first", state().draftItems);
      await new Promise((resolve) => setTimeout(resolve, 710));
    });
    assert.equal(calls.length, 1);

    await act(async () => {
      state().updateDraft("second", state().draftItems);
      await new Promise((resolve) => setTimeout(resolve, 710));
    });
    assert.equal(calls.length, 1);

    await act(async () => {
      resolveFirst({
        ok: true,
        data: { ...baseMenuSet, name: "first", version: 2 },
      });
      await first;
    });

    assert.deepEqual(calls, [
      { version: 1, name: "first" },
      { version: 2, name: "second" },
    ]);
  });

  test("network failure keeps the draft offline and retry saves it", async () => {
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
      state().updateDraft("offline draft", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(state().saveStatus, "offline");
    assert.equal(state().draftName, "offline draft");

    await act(async () => {
      state().retryLastSave();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(attempts, 2);
    assert.equal(state().saveStatus, "saved");
  });

  test("conflict reload replaces a same-id local draft with the server copy", async () => {
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
      state().updateDraft("my local draft", state().draftItems);
      await state().saveCurrent();
    });
    assert.equal(state().saveStatus, "conflict");
    assert.equal(state().draftName, "my local draft");

    await act(async () => state().reloadConflict());
    assert.equal(state().saveStatus, "idle");
    assert.equal(state().draftName, "server latest");
    assert.equal(state().currentMenuSet?.version, 2);
  });

  test("logout aborts requests and clears draft, timers, and local selection", async () => {
    let updateSignal: AbortSignal | undefined;
    const api = successfulApi({
      updateMenuSet(_id, _input, signal) {
        updateSignal = signal;
        return new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            resolve({
              ok: false,
              failure: "aborted",
              error: {
                error: { code: "INTERNAL_ERROR", message: "cancelled" },
              },
            });
          });
        });
      },
    });
    const { cleanup } = await renderHook(api);
    localStorage.setItem("menu-set-selected-id", "set-1");

    await act(async () => {
      state().updateDraft("will abort", state().draftItems);
      void state().saveCurrent();
    });
    assert.equal(updateSignal?.aborted, false);

    await act(async () => cleanup());
    assert.equal(updateSignal?.aborted, true);
    assert.equal(state().menuSets.length, 0);
    assert.equal(state().draftItems.length, 0);
    assert.equal(localStorage.getItem("menu-set-selected-id"), null);
  });
});
