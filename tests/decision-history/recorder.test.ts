import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import {
  AuthContext,
  type AuthContextValue,
} from "../../features/auth/client/context.ts";
import { useDecisionRecorder } from "../../features/decision-history/client/useDecisionRecorder.ts";
import type { DecisionHistoryCreateApiClient } from "../../features/decision-history/client/api.ts";
import type { DecisionDraft } from "../../features/decision-history/client/decision-draft.ts";

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
const draft: DecisionDraft = {
  clientRequestId: "request-1",
  selected: { name: "라멘", emoji: "🍜", color: "#ef4938" },
  candidates: [
    { name: "라멘", emoji: "🍜", color: "#ef4938" },
    { name: "김밥", emoji: "🍙", color: "#2d7a57" },
  ],
  source: { type: "temporary", menuSetId: null, menuSetName: null },
};
let latest: ReturnType<typeof useDecisionRecorder> | null = null;
function Harness({
  api,
  current,
}: {
  api: DecisionHistoryCreateApiClient;
  current: DecisionDraft | null;
}) {
  const value = useDecisionRecorder(current, api);
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
function auth(
  enabled = true,
  status: AuthContextValue["status"] = "authenticated",
  register: (callback: () => void) => void = () => {},
): AuthContextValue {
  return {
    user: status === "authenticated" ? { email: "a@b.c", name: "A" } : null,
    status,
    menuSetsEnabled: false,
    decisionHistoryEnabled: enabled,
    interactiveLoginVersion: 0,
    async login() {},
    async logout() {},
    async refreshSession() {},
    onLogoutCleanup(fn) {
      register(fn);
      return () => {};
    },
  };
}
function response() {
  return {
    ok: true as const,
    data: {
      created: true,
      decision: {
        id: "d1",
        selected: draft.selected,
        candidates: draft.candidates,
        source: draft.source,
        createdAt: 1,
      },
    },
  };
}
async function mount(
  api: DecisionHistoryCreateApiClient,
  value = auth(),
  current = draft,
) {
  let result: ReturnType<typeof render> | null = null;
  await act(async () => {
    result = render(
      createElement(
        AuthContext.Provider,
        { value },
        createElement(Harness, { api, current }),
      ),
    );
  });
  return result as unknown as ReturnType<typeof render>;
}
afterEach(() => {
  latest = null;
  cleanup();
});

test("recorder does not request when disabled or anonymous", async () => {
  let calls = 0;
  const api = {
    async createDecision() {
      calls++;
      return response();
    },
  } as DecisionHistoryCreateApiClient;
  await mount(api, auth(false));
  await act(async () => {
    await latest?.save();
  });
  await mount(api, auth(true, "anonymous"));
  await act(async () => {
    await latest?.save();
  });
  assert.equal(calls, 0);
});
test("recorder prevents duplicate and post-success saves", async () => {
  let calls = 0;
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const api = {
    async createDecision() {
      calls++;
      await pending;
      return response();
    },
  } as DecisionHistoryCreateApiClient;
  await mount(api);
  await act(async () => {
    void latest?.save();
  });
  await act(async () => {
    void latest?.save();
  });
  assert.equal(calls, 1);
  resolve();
  await act(async () => {
    await pending;
  });
  await act(async () => {
    await latest?.save();
  });
  assert.equal(calls, 1);
});
test("failed retry keeps the same draft request ID", async () => {
  const ids: string[] = [];
  let first = true;
  const api = {
    async createDecision(input: DecisionDraft) {
      ids.push(input.clientRequestId);
      if (first) {
        first = false;
        return {
          ok: false as const,
          failure: "network" as const,
          error: {
            error: { code: "INTERNAL_ERROR" as const, message: "offline" },
          },
        };
      }
      return response();
    },
  };
  await mount(api);
  await act(async () => {
    await latest?.save();
  });
  await act(async () => {
    await latest?.save();
  });
  assert.deepEqual(ids, ["request-1", "request-1"]);
});

test("failure exposes an error and a new draft aborts and ignores an old response", async () => {
  let firstSignal: AbortSignal | undefined;
  let resolveFirst!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  let calls = 0;
  const api: DecisionHistoryCreateApiClient = {
    async createDecision(_input, signal) {
      calls += 1;
      if (calls === 1) {
        firstSignal = signal;
        await pending;
        return response();
      }
      return {
        ok: false,
        failure: "network",
        error: { error: { code: "INTERNAL_ERROR", message: "offline" } },
      };
    },
  };
  const mounted = await mount(api);
  void latest?.save();
  const nextDraft = { ...draft, clientRequestId: "request-2" };
  await act(async () => {
    mounted.rerender(
      createElement(
        AuthContext.Provider,
        { value: auth() },
        createElement(Harness, { api, current: nextDraft }),
      ),
    );
  });
  assert.equal(firstSignal?.aborted, true);
  assert.equal(latest?.status, "idle");
  resolveFirst();
  await act(async () => {
    await pending;
  });
  assert.equal(latest?.status, "idle");
  await act(async () => {
    await latest?.save();
  });
  assert.equal(latest?.status, "error");
  assert.equal(latest?.error, "offline");
});

test("logout cleanup aborts an in-flight request and resets recorder state", async () => {
  let logoutCleanup: (() => void) | null = null;
  let signal: AbortSignal | undefined;
  const api: DecisionHistoryCreateApiClient = {
    createDecision(_input, requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    },
  };
  await mount(
    api,
    auth(true, "authenticated", (callback) => {
      logoutCleanup = callback;
    }),
  );
  await act(async () => {
    void latest?.save();
  });
  assert.equal(latest?.status, "saving");
  await act(async () => {
    logoutCleanup?.();
  });
  assert.equal(signal?.aborted, true);
  assert.equal(latest?.status, "idle");
});
