import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement, StrictMode, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import {
  AuthContext,
  type AuthContextValue,
} from "../../features/auth/client/context.ts";
import {
  useDecisionHistory,
} from "../../features/decision-history/client/useDecisionHistory.ts";
import type {
  DecisionHistoryApiClient,
  DecisionHistoryListResult,
} from "../../features/decision-history/client/api.ts";
import type {
  DecisionHistoryResponse,
} from "../../features/decision-history/shared/contract.ts";

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

function decision(id = "one"): DecisionHistoryResponse {
  return {
    id,
    selected: { name: "라멘", emoji: "🍜", color: "#fff" },
    candidates: [
      { name: "라멘", emoji: "🍜", color: "#fff" },
      { name: "김밥", emoji: "🍙", color: "#000" },
    ],
    source: {
      type: "temporary",
      menuSetId: null,
      menuSetName: null,
    },
    createdAt: 1_000,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function api(
  overrides: Partial<DecisionHistoryApiClient> = {},
): DecisionHistoryApiClient {
  return {
    async createDecision() {
      return {
        ok: false,
        failure: "network",
        error: {
          error: { code: "INTERNAL_ERROR", message: "unused" },
        },
      };
    },
    async listDecisions() {
      return { ok: true, data: { decisions: [decision()] } };
    },
    async deleteDecision() {
      return { ok: true, data: { ok: true } };
    },
    async deleteAllDecisions() {
      return { ok: true, data: { deletedCount: 1 } };
    },
    ...overrides,
  };
}

type HookValue = ReturnType<typeof useDecisionHistory>;
type RenderOptions = {
  open?: boolean;
  refreshToken?: number;
  status?: AuthContextValue["status"];
  featureEnabled?: boolean;
  apiClient: DecisionHistoryApiClient;
  strict?: boolean;
};

let latest: HookValue | null = null;

function current(): HookValue {
  if (!latest) throw new Error("hook state is not ready");
  return latest;
}

function Harness({
  open,
  refreshToken,
  apiClient,
  onLogout,
}: {
  open: boolean;
  refreshToken: number;
  apiClient: DecisionHistoryApiClient;
  onLogout: () => void;
}) {
  const value = useDecisionHistory({
    open,
    refreshToken,
    apiClient,
    onLogout,
  });
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

function mount(initial: RenderOptions) {
  let options = {
    open: initial.open ?? true,
    refreshToken: initial.refreshToken ?? 0,
    status: initial.status ?? ("authenticated" as const),
    featureEnabled: initial.featureEnabled ?? true,
    apiClient: initial.apiClient,
    strict: initial.strict ?? false,
  };
  const logoutCallbacks = new Set<() => void>();
  let closeCount = 0;

  const onLogoutCleanup: AuthContextValue["onLogoutCleanup"] = (callback) => {
    logoutCallbacks.add(callback);
    return () => logoutCallbacks.delete(callback);
  };

  function tree() {
    const auth: AuthContextValue = {
      user:
        options.status === "authenticated"
          ? { name: "사용자", email: "user@example.com" }
          : null,
      status: options.status,
      menuSetsEnabled: false,
      decisionHistoryEnabled: options.featureEnabled,
      interactiveLoginVersion: 0,
      async login() {},
      async logout() {},
      async refreshSession() {},
      onLogoutCleanup,
    };
    const harness = createElement(Harness, {
      open: options.open,
      refreshToken: options.refreshToken,
      apiClient: options.apiClient,
      onLogout: () => {
        closeCount += 1;
      },
    });
    return createElement(
      AuthContext.Provider,
      { value: auth },
      options.strict ? createElement(StrictMode, null, harness) : harness,
    );
  }

  const view = render(tree());
  return {
    rerender(next: Partial<RenderOptions>) {
      options = { ...options, ...next };
      view.rerender(tree());
    },
    runLogout() {
      for (const callback of [...logoutCallbacks]) callback();
    },
    get closeCount() {
      return closeCount;
    },
  };
}

afterEach(() => {
  latest = null;
  cleanup();
});

test("fetches only when the feature, session, and drawer are active", async () => {
  let calls = 0;
  const client = api({
    async listDecisions() {
      calls += 1;
      return { ok: true, data: { decisions: [] } };
    },
  });

  const closed = mount({ open: false, apiClient: client });
  await act(async () => {});
  assert.equal(calls, 0);
  cleanup();

  mount({ open: true, featureEnabled: false, apiClient: client });
  await act(async () => {});
  assert.equal(calls, 0);
  cleanup();

  mount({ open: true, status: "anonymous", apiClient: client });
  await act(async () => {});
  assert.equal(calls, 0);
  cleanup();

  mount({ open: true, apiClient: client });
  await act(async () => {});
  assert.equal(calls, 1);
  assert.equal(latest?.status, "ready");
  void closed;
});

test("closing aborts the active query, ignores its late result, and reopening refetches", async () => {
  const first = deferred<DecisionHistoryListResult>();
  const signals: AbortSignal[] = [];
  let calls = 0;
  const client = api({
    listDecisions(signal) {
      calls += 1;
      if (signal) signals.push(signal);
      return calls === 1
        ? first.promise
        : Promise.resolve({
            ok: true,
            data: { decisions: [decision("new")] },
          });
    },
  });
  const view = mount({ apiClient: client });
  await act(async () => {});
  assert.equal(calls, 1);

  await act(async () => view.rerender({ open: false }));
  assert.equal(signals[0]?.aborted, true);
  await act(async () => {
    first.resolve({
      ok: true,
      data: { decisions: [decision("stale")] },
    });
  });
  assert.deepEqual(latest?.decisions, []);

  await act(async () => view.rerender({ open: true }));
  assert.equal(calls, 2);
  assert.equal(current().decisions[0]?.id, "new");
});

test("a refresh token replaces an in-flight query and the newest response wins", async () => {
  const requests = [
    deferred<DecisionHistoryListResult>(),
    deferred<DecisionHistoryListResult>(),
  ];
  const signals: AbortSignal[] = [];
  let calls = 0;
  const client = api({
    listDecisions(signal) {
      if (signal) signals.push(signal);
      return requests[calls++].promise;
    },
  });
  const view = mount({ apiClient: client });
  await act(async () => {});
  assert.equal(calls, 1);

  await act(async () => view.rerender({ refreshToken: 1 }));
  assert.equal(signals[0]?.aborted, true);
  assert.equal(calls, 2);

  await act(async () => {
    requests[0].resolve({
      ok: true,
      data: { decisions: [decision("old")] },
    });
    requests[1].resolve({
      ok: true,
      data: { decisions: [decision("latest")] },
    });
  });
  assert.equal(current().decisions[0]?.id, "latest");
});

test("manual refresh and mutation locks reject same-tick duplicates", async () => {
  const refreshRequest = deferred<DecisionHistoryListResult>();
  const deleteRequest = deferred<
    Awaited<ReturnType<DecisionHistoryApiClient["deleteDecision"]>>
  >();
  let listCalls = 0;
  let deleteCalls = 0;
  const client = api({
    listDecisions() {
      listCalls += 1;
      return listCalls === 1
        ? Promise.resolve({
            ok: true,
            data: { decisions: [decision()] },
          })
        : refreshRequest.promise;
    },
    deleteDecision() {
      deleteCalls += 1;
      return deleteRequest.promise;
    },
  });
  mount({ apiClient: client });
  await act(async () => {});

  await act(async () => {
    void latest?.refresh();
    void latest?.refresh();
  });
  assert.equal(listCalls, 2);
  await act(async () => {
    refreshRequest.resolve({
      ok: true,
      data: { decisions: [decision()] },
    });
  });

  await act(async () => {
    void latest?.deleteDecision("one");
    void latest?.deleteDecision("one");
  });
  assert.equal(deleteCalls, 1);
  await act(async () => {
    deleteRequest.resolve({ ok: true, data: { ok: true } });
  });
});

test("individual delete success updates the list and failure preserves it", async () => {
  let shouldFail = true;
  const client = api({
    async listDecisions() {
      return { ok: true, data: { decisions: [decision()] } };
    },
    async deleteDecision() {
      return shouldFail
        ? {
            ok: false,
            failure: "http",
            error: {
              error: { code: "INTERNAL_ERROR", message: "삭제 실패" },
            },
          }
        : { ok: true, data: { ok: true } };
    },
  });
  mount({ apiClient: client });
  await act(async () => {});

  await act(async () => {
    await latest?.deleteDecision("one");
  });
  assert.equal(latest?.decisions.length, 1);
  assert.equal(latest?.mutationError, "삭제 실패");

  shouldFail = false;
  await act(async () => {
    await latest?.deleteDecision("one");
  });
  assert.equal(latest?.decisions.length, 0);
  assert.equal(latest?.mutationError, null);
});

test("delete-all success clears records while failure preserves them", async () => {
  let shouldFail = true;
  const client = api({
    async deleteAllDecisions() {
      return shouldFail
        ? {
            ok: false,
            failure: "network",
            error: {
              error: { code: "INTERNAL_ERROR", message: "전체 삭제 실패" },
            },
          }
        : { ok: true, data: { deletedCount: 1 } };
    },
  });
  mount({ apiClient: client });
  await act(async () => {});

  await act(async () => {
    await latest?.deleteAll();
  });
  assert.equal(latest?.decisions.length, 1);
  assert.equal(latest?.mutationError, "전체 삭제 실패");

  shouldFail = false;
  await act(async () => {
    await latest?.deleteAll();
  });
  assert.equal(latest?.decisions.length, 0);
});

test("logout clears and closes immediately while late query and mutation results are ignored", async () => {
  const query = deferred<DecisionHistoryListResult>();
  const clientWithLateQuery = api({
    listDecisions() {
      return query.promise;
    },
  });
  const queryView = mount({ apiClient: clientWithLateQuery });
  await act(async () => {});
  await act(async () => queryView.runLogout());
  assert.equal(queryView.closeCount, 1);
  assert.equal(latest?.status, "idle");
  assert.deepEqual(latest?.decisions, []);
  await act(async () => {
    query.resolve({
      ok: true,
      data: { decisions: [decision("late")] },
    });
  });
  assert.deepEqual(latest?.decisions, []);
  cleanup();

  const deletion = deferred<
    Awaited<ReturnType<DecisionHistoryApiClient["deleteDecision"]>>
  >();
  const clientWithLateDelete = api({
    deleteDecision() {
      return deletion.promise;
    },
  });
  const deleteView = mount({ apiClient: clientWithLateDelete });
  await act(async () => {});
  await act(async () => {
    void latest?.deleteDecision("one");
  });
  assert.equal(latest?.deletingId, "one");
  await act(async () => deleteView.runLogout());
  assert.equal(deleteView.closeCount, 1);
  assert.equal(latest?.deletingId, null);
  assert.equal(latest?.mutationError, null);
  await act(async () => {
    deletion.resolve({
      ok: false,
      failure: "http",
      error: {
        error: { code: "INTERNAL_ERROR", message: "late error" },
      },
    });
  });
  assert.equal(latest?.mutationError, null);
  assert.deepEqual(latest?.decisions, []);
});

test("StrictMode effect replay still accepts the active query result", async () => {
  let calls = 0;
  const client = api({
    async listDecisions() {
      calls += 1;
      return { ok: true, data: { decisions: [decision("strict")] } };
    },
  });
  mount({ apiClient: client, strict: true });
  await act(async () => {});
  assert.ok(calls >= 1);
  assert.equal(latest?.status, "ready");
  assert.equal(current().decisions[0]?.id, "strict");
});
