import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: string | URL | Request) => Promise<Response> | Response) {
  globalThis.fetch = async (input: string | URL | Request) => handler(input);
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

test.afterEach(() => {
  restoreFetch();
});

test("fetchSession returns user on success", async () => {
  mockFetch(() =>
    Response.json({ user: { email: "a@b.com", name: "Test" } }),
  );
  const { fetchSession } = await import("../../features/auth/client/api.ts");
  const user = await fetchSession();
  assert.deepStrictEqual(user, { email: "a@b.com", name: "Test" });
});

test("fetchSession returns null on non-2xx", async () => {
  mockFetch(() => new Response("error", { status: 500 }));
  const { fetchSession } = await import("../../features/auth/client/api.ts");
  const user = await fetchSession();
  assert.equal(user, null);
});

test("fetchSession returns null when user is null in response", async () => {
  mockFetch(() => Response.json({ user: null }));
  const { fetchSession } = await import("../../features/auth/client/api.ts");
  const user = await fetchSession();
  assert.equal(user, null);
});

test("fetchSessionStrict returns user on success", async () => {
  mockFetch(() =>
    Response.json({ user: { email: "a@b.com", name: "Test" } }),
  );
  const { fetchSessionStrict } = await import("../../features/auth/client/api.ts");
  const user = await fetchSessionStrict();
  assert.deepStrictEqual(user, { email: "a@b.com", name: "Test" });
});

test("fetchSessionStrict throws on non-2xx", async () => {
  mockFetch(() => new Response("error", { status: 500 }));
  const { fetchSessionStrict } = await import("../../features/auth/client/api.ts");
  await assert.rejects(() => fetchSessionStrict(), {
    message: "로그인 세션을 확인하지 못했습니다.",
  });
});

test("fetchSessionStrict throws when user is null in response", async () => {
  mockFetch(() => Response.json({ user: null }));
  const { fetchSessionStrict } = await import("../../features/auth/client/api.ts");
  await assert.rejects(() => fetchSessionStrict(), {
    message: "로그인 세션을 확인하지 못했습니다.",
  });
});

test("fetchSessionStrict throws on network error", async () => {
  mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const { fetchSessionStrict } = await import("../../features/auth/client/api.ts");
  await assert.rejects(() => fetchSessionStrict());
});
