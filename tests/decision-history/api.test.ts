import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { signSession } from "../../features/auth/server/session.server.ts";
import {
  handleDecisionHistoryCreateRequest,
  handleDecisionHistoryDeleteAllRequest,
  handleDecisionHistoryDeleteRequest,
  handleDecisionHistoryListRequest,
} from "../../features/decision-history/server/handlers.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";
import type { AppRuntimeEnv } from "../../server/runtime-env.server.ts";
import { applyMigrations, createTestD1, disposeTestD1 } from "../users/helpers.ts";

const APP_ORIGIN = "https://hangry-and-idk.test";
const SESSION_SECRET = "decision-history-api-test-secret-with-enough-entropy";
let db: D1Database;

const allowLimiter = { async limit() { return { success: true }; } };

function runtimeEnv(overrides: Partial<AppRuntimeEnv> = {}): AppRuntimeEnv {
  return {
    APP_ORIGIN, AUTH_SESSION_SECRET: SESSION_SECRET,
    FEATURE_DECISION_HISTORY: "true", DB: db, APP_WRITE_RATE_LIMITER: allowLimiter,
    ...overrides,
  };
}

async function sessionCookie(subject: string): Promise<string> {
  const token = await signSession({ provider: "firebase", subject }, SESSION_SECRET);
  return `omuo_session=${token}`;
}

async function request(
  path: string, method: string, subject: string,
  options: { body?: unknown; headers?: Record<string, string>; origin?: boolean } = {},
): Promise<Request> {
  const { body, headers = {}, origin = true } = options;
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      Cookie: await sessionCookie(subject),
      ...(origin ? { Origin: APP_ORIGIN } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function validBody(clientRequestId = "request-1", name = "라멘") {
  return {
    clientRequestId,
    selected: { name, emoji: "🍜", color: "#112233" },
    candidates: [
      { name, emoji: "🍜", color: "#112233" },
      { name: "김밥", emoji: "🍚", color: "#445566" },
    ],
    source: { type: "temporary", menuSetId: null, menuSetName: null },
  };
}

async function create(subject: string, requestId: string, name = "라멘") {
  return handleDecisionHistoryCreateRequest(
    await request("/api/decision-history", "POST", subject, { body: validBody(requestId, name) }),
    runtimeEnv(),
  );
}

describe("decision history HTTP handlers", () => {
  before(async () => { db = await createTestD1(); await applyMigrations(db); });
  after(disposeTestD1);

  test("feature off is a private controlled 404", async () => {
    const response = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`), runtimeEnv({ FEATURE_DECISION_HISTORY: "false" }));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "FEATURE_DISABLED");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test("anonymous request returns 401", async () => {
    const response = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`), runtimeEnv());
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  });

  test("forged Origin is rejected for POST and both DELETE routes", async () => {
    const headers = { Origin: "https://attacker.test" };
    const responses = await Promise.all([
      handleDecisionHistoryCreateRequest(await request("/api/decision-history", "POST", "origin", { body: validBody(), headers }), runtimeEnv()),
      handleDecisionHistoryDeleteRequest(await request("/api/decision-history/id", "DELETE", "origin", { headers }), runtimeEnv(), "id"),
      handleDecisionHistoryDeleteAllRequest(await request("/api/decision-history", "DELETE", "origin", { headers }), runtimeEnv()),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "INVALID_ORIGIN");
    }
  });

  test("missing, non-JSON, malformed, and oversized actual bodies return 400", async () => {
    const requests = await Promise.all([
      request("/api/decision-history", "POST", "body-missing"),
      request("/api/decision-history", "POST", "body-non-json", { body: "text", headers: { "Content-Type": "text/plain" } }),
      request("/api/decision-history", "POST", "body-malformed", { body: "{" }),
      request("/api/decision-history", "POST", "body-oversized", { body: "x".repeat(10_001) }),
    ]);
    for (const requestValue of requests) {
      const response = await handleDecisionHistoryCreateRequest(requestValue, runtimeEnv());
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_DECISION_HISTORY");
    }
  });

  test("missing secret, D1 binding, and limiter fail closed", async () => {
    const base = await request("/api/decision-history", "POST", "config", { body: validBody() });
    for (const env of [runtimeEnv({ AUTH_SESSION_SECRET: undefined }), runtimeEnv({ DB: undefined }), runtimeEnv({ APP_WRITE_RATE_LIMITER: undefined })]) {
      const response = await handleDecisionHistoryCreateRequest(base.clone(), env);
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error.code, "SERVER_CONFIG_ERROR");
    }
  });

  test("rate-limit denial has Retry-After and failures do not leak", async () => {
    const base = await request("/api/decision-history", "POST", "limit", { body: validBody() });
    const denied = await handleDecisionHistoryCreateRequest(base.clone(), runtimeEnv({ APP_WRITE_RATE_LIMITER: { async limit() { return { success: false }; } } }));
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("Retry-After"), "60");
    const unavailable = await handleDecisionHistoryCreateRequest(base, runtimeEnv({ APP_WRITE_RATE_LIMITER: { async limit() { throw new Error("limit secret"); } } }));
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(await unavailable.text(), /limit secret/);
  });

  test("new create is 201, retry is 200, and retains the first payload", async () => {
    const first = await create("idempotent", "same", "라멘");
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { decision: { id: string; selected: { name: string } }; created: boolean };
    const retry = await create("idempotent", "same", "우동");
    assert.equal(retry.status, 200);
    const retryBody = await retry.json() as { decision: { id: string; selected: { name: string } }; created: boolean };
    assert.equal(firstBody.created, true);
    assert.equal(retryBody.created, false);
    assert.equal(retryBody.decision.id, firstBody.decision.id);
    assert.equal(retryBody.decision.selected.name, "라멘");
  });

  test("responses exclude private ownership and idempotency fields", async () => {
    const response = await handleDecisionHistoryCreateRequest(await request("/api/decision-history", "POST", "private", { body: { ...validBody("private-id"), ownerUserId: "forged", createdAt: 0 } }), runtimeEnv());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.doesNotMatch(await response.text(), /owner|clientRequestId|createdAt":0/i);
  });

  test("list returns the latest ten in newest-first order", async () => {
    for (let index = 0; index < 11; index += 1) assert.equal((await create("recent", `recent-${index}`, `메뉴${index}`)).status, 201);
    const response = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`, { headers: { Cookie: await sessionCookie("recent") } }), runtimeEnv());
    const body = await response.json() as { decisions: { selected: { name: string } }[] };
    assert.deepEqual(body.decisions.map(({ selected }) => selected.name), ["메뉴10", "메뉴9", "메뉴8", "메뉴7", "메뉴6", "메뉴5", "메뉴4", "메뉴3", "메뉴2", "메뉴1"]);
  });

  test("lists are isolated by owner", async () => {
    await create("list-a", "a", "라멘"); await create("list-b", "b", "우동");
    const response = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`, { headers: { Cookie: await sessionCookie("list-a") } }), runtimeEnv());
    const body = await response.json() as { decisions: { selected: { name: string } }[] };
    assert.deepEqual(body.decisions.map(({ selected }) => selected.name), ["라멘"]);
  });

  test("other-owner and missing deletes are indistinguishable", async () => {
    const created = await (await create("delete-owner", "private-delete")).json() as { decision: { id: string } };
    const [other, missing] = await Promise.all([
      handleDecisionHistoryDeleteRequest(await request(`/api/decision-history/${created.decision.id}`, "DELETE", "not-owner"), runtimeEnv(), created.decision.id),
      handleDecisionHistoryDeleteRequest(await request("/api/decision-history/missing", "DELETE", "delete-owner"), runtimeEnv(), "missing"),
    ]);
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), await missing.json());
  });

  test("owner deletes one and delete-all reports count without affecting others", async () => {
    const one = await (await create("delete-all", "one")).json() as { decision: { id: string } };
    await create("delete-all", "two"); await create("delete-other", "other");
    assert.equal((await handleDecisionHistoryDeleteRequest(await request(`/api/decision-history/${one.decision.id}`, "DELETE", "delete-all"), runtimeEnv(), one.decision.id)).status, 200);
    const deleted = await handleDecisionHistoryDeleteAllRequest(await request("/api/decision-history", "DELETE", "delete-all"), runtimeEnv());
    assert.deepEqual(await deleted.json(), { deletedCount: 1 });
    const other = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`, { headers: { Cookie: await sessionCookie("delete-other") } }), runtimeEnv());
    assert.equal((await other.json() as { decisions: unknown[] }).decisions.length, 1);
  });

  test("malformed public shapes return 400", async () => {
    for (const body of [{ ...validBody("bad-selected"), selected: null }, { ...validBody("bad-source"), source: { type: "temporary", menuSetId: "id", menuSetName: null } }, { ...validBody("bad-candidate"), candidates: [{}] }]) {
      assert.equal((await handleDecisionHistoryCreateRequest(await request("/api/decision-history", "POST", "bad", { body }), runtimeEnv())).status, 400);
    }
  });

  test("database errors do not expose internals", async () => {
    const response = await handleDecisionHistoryListRequest(new Request(`${APP_ORIGIN}/api/decision-history`, { headers: { Cookie: await sessionCookie("db-error") } }), runtimeEnv({ DB: { prepare() { throw new Error("database password"); } } as unknown as D1Database }));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /database password/);
  });
});
