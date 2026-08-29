import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { signSession } from "../../features/auth/server/session.server.ts";
import {
  handleMenuSetArchiveRequest,
  handleMenuSetCreateRequest,
  handleMenuSetDefaultRequest,
  handleMenuSetGetRequest,
  handleMenuSetListRequest,
  handleMenuSetUpdateRequest,
} from "../../features/menu-sets/server/handlers.server.ts";
import type { AppRuntimeEnv } from "../../server/runtime-env.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";
import {
  applyMigrations,
  createTestD1,
  disposeTestD1,
} from "../users/helpers.ts";

const APP_ORIGIN = "https://hangry-and-idk.test";
const SESSION_SECRET = "menu-set-api-test-secret-with-enough-entropy";

let db: D1Database;

const allowLimiter = {
  async limit() {
    return { success: true };
  },
};

function runtimeEnv(overrides: Partial<AppRuntimeEnv> = {}): AppRuntimeEnv {
  return {
    APP_ORIGIN,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    FEATURE_MENU_SETS: "true",
    DB: db,
    APP_WRITE_RATE_LIMITER: allowLimiter,
    ...overrides,
  };
}

async function sessionCookie(subject: string): Promise<string> {
  const token = await signSession(
    { provider: "firebase", subject },
    SESSION_SECRET,
  );
  return `omuo_session=${token}`;
}

async function mutationRequest(
  path: string,
  method: string,
  subject: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Request> {
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      Cookie: await sessionCookie(subject),
      Origin: APP_ORIGIN,
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validCreateBody(name = "회사 점심") {
  return {
    name,
    items: [
      { id: null, name: "한식", emoji: "🍚", color: "#ef4938" },
      { id: null, name: "일식", emoji: "🍣", color: "#2d7a57" },
    ],
  };
}

describe("menu-set HTTP handlers", () => {
  before(async () => {
    db = await createTestD1();
    await applyMigrations(db);
  });

  test("feature flag off returns controlled 404", async () => {
    const response = await handleMenuSetListRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets`),
      runtimeEnv({ FEATURE_MENU_SETS: "false" }),
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "FEATURE_DISABLED");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test("anonymous request returns 401 when feature is enabled", async () => {
    const response = await handleMenuSetListRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets`),
      runtimeEnv(),
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  });

  test("forged Origin is rejected before mutation", async () => {
    const request = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "origin-user",
      validCreateBody(),
      { Origin: "https://attacker.example" },
    );
    const response = await handleMenuSetCreateRequest(request, runtimeEnv());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "INVALID_ORIGIN");
  });

  test("non-JSON, oversized, and malformed item bodies return 400", async () => {
    const cookie = await sessionCookie("invalid-body-user");
    const nonJson = new Request(`${APP_ORIGIN}/api/menu-sets`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: APP_ORIGIN, "Content-Type": "text/plain" },
      body: "not json",
    });
    assert.equal(
      (await handleMenuSetCreateRequest(nonJson, runtimeEnv())).status,
      400,
    );

    const disguisedNonJson = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "invalid-body-user",
      validCreateBody(),
      { "Content-Type": "text/plain; note=application/json" },
    );
    assert.equal(
      (await handleMenuSetCreateRequest(disguisedNonJson, runtimeEnv())).status,
      400,
    );

    const oversized = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "invalid-body-user",
      validCreateBody(),
      { "Content-Length": "50001" },
    );
    assert.equal(
      (await handleMenuSetCreateRequest(oversized, runtimeEnv())).status,
      400,
    );

    const malformed = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "invalid-body-user",
      { name: "bad", items: [null, 1] },
    );
    const malformedResponse = await handleMenuSetCreateRequest(
      malformed,
      runtimeEnv(),
    );
    assert.equal(malformedResponse.status, 400);
    assert.equal((await malformedResponse.json()).error.code, "INVALID_MENU_SET");
  });

  test("missing write limiter fails closed", async () => {
    const request = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "no-limiter-user",
      validCreateBody(),
    );
    const response = await handleMenuSetCreateRequest(
      request,
      runtimeEnv({ APP_WRITE_RATE_LIMITER: undefined }),
    );
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, "SERVER_CONFIG_ERROR");
  });

  test("forged ownership fields are ignored and private fields are not returned", async () => {
    const request = await mutationRequest(
      "/api/menu-sets",
      "POST",
      "owner-a",
      {
        ...validCreateBody("private response"),
        ownerUserId: "forged-owner",
        userId: "forged-user",
        firebaseUid: "forged-firebase",
        version: 999,
        status: "archived",
      },
    );
    const response = await handleMenuSetCreateRequest(request, runtimeEnv());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.version, 1);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /owner|firebase|owner_user_id/i);
  });

  test("another owner and a missing id both return the same 404", async () => {
    const create = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "private-owner",
        validCreateBody("private set"),
      ),
      runtimeEnv(),
    );
    const created = await create.json() as { id: string };
    const otherOwnerRequest = new Request(
      `${APP_ORIGIN}/api/menu-sets/${created.id}`,
      { headers: { Cookie: await sessionCookie("other-owner") } },
    );
    const missingRequest = new Request(
      `${APP_ORIGIN}/api/menu-sets/missing`,
      { headers: { Cookie: await sessionCookie("private-owner") } },
    );
    const [other, missing] = await Promise.all([
      handleMenuSetGetRequest(otherOwnerRequest, runtimeEnv(), created.id),
      handleMenuSetGetRequest(missingRequest, runtimeEnv(), "missing"),
    ]);
    assert.equal(other.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await other.json(), await missing.json());
  });

  test("fractional versions are rejected and stale versions return 409", async () => {
    const create = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "version-owner",
        validCreateBody("versioned"),
      ),
      runtimeEnv(),
    );
    const created = await create.json() as {
      id: string;
      version: number;
      items: { id: string; name: string; emoji: string; color: string }[];
    };
    const updateBody = {
      version: created.version,
      name: "updated",
      items: created.items,
    };
    const fractional = await handleMenuSetUpdateRequest(
      await mutationRequest(
        `/api/menu-sets/${created.id}`,
        "PUT",
        "version-owner",
        { ...updateBody, version: 1.5 },
      ),
      runtimeEnv(),
      created.id,
    );
    assert.equal(fractional.status, 400);

    const success = await handleMenuSetUpdateRequest(
      await mutationRequest(
        `/api/menu-sets/${created.id}`,
        "PUT",
        "version-owner",
        updateBody,
      ),
      runtimeEnv(),
      created.id,
    );
    assert.equal(success.status, 200);

    const stale = await handleMenuSetUpdateRequest(
      await mutationRequest(
        `/api/menu-sets/${created.id}`,
        "PUT",
        "version-owner",
        updateBody,
      ),
      runtimeEnv(),
      created.id,
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "MENU_SET_VERSION_CONFLICT");
  });

  test("default mutation requires a bounded JSON object body", async () => {
    const create = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "default-owner",
        validCreateBody("default target"),
      ),
      runtimeEnv(),
    );
    const created = await create.json() as { id: string };
    const cookie = await sessionCookie("default-owner");
    const missingBody = new Request(
      `${APP_ORIGIN}/api/menu-sets/${created.id}/default`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: APP_ORIGIN },
      },
    );
    assert.equal(
      (
        await handleMenuSetDefaultRequest(
          missingBody,
          runtimeEnv(),
          created.id,
        )
      ).status,
      400,
    );

    const valid = await handleMenuSetDefaultRequest(
      await mutationRequest(
        `/api/menu-sets/${created.id}/default`,
        "POST",
        "default-owner",
        {},
      ),
      runtimeEnv(),
      created.id,
    );
    assert.equal(valid.status, 200);
  });

  test("limiter allow lets the mutation succeed", async () => {
    let limitCalls = 0;
    const allowLimiter = {
      async limit() {
        limitCalls += 1;
        return { success: true };
      },
    };
    const response = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "limiter-allow-user",
        validCreateBody("limiter allow"),
      ),
      runtimeEnv({ APP_WRITE_RATE_LIMITER: allowLimiter }),
    );
    assert.equal(response.status, 201);
    assert.equal(limitCalls, 1);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test("limiter deny returns 429 with Retry-After", async () => {
    const denyLimiter = {
      async limit() {
        return { success: false };
      },
    };
    const response = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "limiter-deny-user",
        validCreateBody("limiter deny"),
      ),
      runtimeEnv({ APP_WRITE_RATE_LIMITER: denyLimiter }),
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test("limiter throw returns controlled 503", async () => {
    const throwingLimiter = {
      async limit() {
        throw new Error("rate limiter unavailable");
      },
    };
    const response = await handleMenuSetCreateRequest(
      await mutationRequest(
        "/api/menu-sets",
        "POST",
        "limiter-throw-user",
        validCreateBody("limiter throw"),
      ),
      runtimeEnv({ APP_WRITE_RATE_LIMITER: throwingLimiter }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /rate limiter unavailable/);
  });

  test("malformed item types in mutation return 400 without leaking", async () => {
    const cookie = await sessionCookie("malformed-item-user");
    const headers = { Cookie: cookie, Origin: APP_ORIGIN, "Content-Type": "application/json" };
    const cases: Array<{ label: string; payload: unknown }> = [
      { label: "id as number", payload: { name: "x", items: [{ id: 1, name: "a", emoji: "🍚", color: "#000000" }] } },
      { label: "id as boolean", payload: { name: "x", items: [{ id: false, name: "a", emoji: "🍚", color: "#000000" }] } },
      { label: "id as empty string", payload: { name: "x", items: [{ id: "", name: "a", emoji: "🍚", color: "#000000" }] } },
      { label: "name as number", payload: { name: "x", items: [{ id: null, name: 1, emoji: "🍚", color: "#000000" }] } },
      { label: "emoji as boolean", payload: { name: "x", items: [{ id: null, name: "a", emoji: true, color: "#000000" }] } },
      { label: "color as null", payload: { name: "x", items: [{ id: null, name: "a", emoji: "🍚", color: null }] } },
      { label: "item as array", payload: { name: "x", items: [["a", "b"]] } },
      { label: "item as string", payload: { name: "x", items: ["a"] } },
      { label: "items missing", payload: { name: "x" } },
      { label: "items not array", payload: { name: "x", items: {} } },
    ];

    for (const { label, payload } of cases) {
      const response = await handleMenuSetCreateRequest(
        new Request(`${APP_ORIGIN}/api/menu-sets`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }),
        runtimeEnv(),
      );
      assert.equal(response.status, 400, label);
      assert.equal(
        (await response.json()).error.code,
        "INVALID_MENU_SET",
        label,
      );
      assert.equal(
        response.headers.get("Cache-Control"),
        "private, no-store",
        label,
      );
    }
  });

  test("non-positive and oversized versions are rejected with 400", async () => {
    const cookie = await sessionCookie("bad-version-user");
    const headers = { Cookie: cookie, Origin: APP_ORIGIN, "Content-Type": "application/json" };

    const negative = await handleMenuSetUpdateRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets/x`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: -1, name: "x", items: [] }),
      }),
      runtimeEnv(),
      "x",
    );
    assert.equal(negative.status, 400);
    assert.equal((await negative.json()).error.code, "INVALID_MENU_SET");
    assert.equal(negative.headers.get("Cache-Control"), "private, no-store");

    const zero = await handleMenuSetUpdateRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets/x`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: 0, name: "x", items: [] }),
      }),
      runtimeEnv(),
      "x",
    );
    assert.equal(zero.status, 400);
    assert.equal(zero.headers.get("Cache-Control"), "private, no-store");

    const stringVersion = await handleMenuSetUpdateRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets/x`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: "1", name: "x", items: [] }),
      }),
      runtimeEnv(),
      "x",
    );
    assert.equal(stringVersion.status, 400);
    assert.equal(stringVersion.headers.get("Cache-Control"), "private, no-store");

    const hugeVersion = await handleMenuSetUpdateRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets/x`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: Number.MAX_SAFE_INTEGER + 2, name: "x", items: [] }),
      }),
      runtimeEnv(),
      "x",
    );
    assert.equal(hugeVersion.status, 400);
    assert.equal(hugeVersion.headers.get("Cache-Control"), "private, no-store");
  });

  test("archive request rejects malformed body without DB access", async () => {
    const cookie = await sessionCookie("archive-bad-body-user");
    const headers = { Cookie: cookie, Origin: APP_ORIGIN, "Content-Type": "application/json" };
    const response = await handleMenuSetArchiveRequest(
      new Request(`${APP_ORIGIN}/api/menu-sets/x`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ version: "1.5" }),
      }),
      runtimeEnv(),
      "x",
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_MENU_SET");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test("DB errors during mutation do not expose stack or internal details", async () => {
    const { createMenuSetService } = await import(
      "../../features/menu-sets/server/service.server.ts"
    );
    const { defaultClock, defaultIdGenerator } = await import(
      "../../server/db/types.server.ts"
    );
    const internalMessage = "FATAL: stack trace would be here\n  at line 42";
    const failingRepo = {
      listByOwner: async () => { throw new Error(internalMessage); },
      findByIdAndOwner: async () => { throw new Error(internalMessage); },
      countActiveByOwner: async () => { throw new Error(internalMessage); },
      create: async () => { throw new Error(internalMessage); },
      updateAggregate: async () => { throw new Error(internalMessage); },
      archiveWithFallback: async () => { throw new Error(internalMessage); },
      setDefault: async () => { throw new Error(internalMessage); },
    };
    const service = createMenuSetService({
      repository: failingRepo,
      clock: defaultClock,
      idGenerator: defaultIdGenerator,
    });

    const list = await service.list("db-error-user");
    assert.equal(list.ok, false);
    if (!list.ok) {
      assert.equal(list.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(list.error.message, /FATAL/);
    }

    const get = await service.get("x", "db-error-user");
    assert.equal(get.ok, false);
    if (!get.ok) {
      assert.equal(get.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(get.error.message, /FATAL/);
    }

    const update = await service.update("x", "db-error-user", {
      version: 1,
      name: "x",
      items: [
        { id: null, name: "a", emoji: "🍚", color: "#000000" },
        { id: null, name: "b", emoji: "🥟", color: "#f6c84a" },
      ],
    });
    assert.equal(update.ok, false);
    if (!update.ok) {
      assert.equal(update.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(update.error.message, /FATAL/);
    }

    const archive = await service.archive("x", "db-error-user", { version: 1 });
    assert.equal(archive.ok, false);
    if (!archive.ok) {
      assert.equal(archive.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(archive.error.message, /FATAL/);
    }

    const setDefault = await service.setDefault("x", "db-error-user");
    assert.equal(setDefault.ok, false);
    if (!setDefault.ok) {
      assert.equal(setDefault.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(setDefault.error.message, /FATAL/);
    }
  });

  after(async () => {
    await disposeTestD1();
  });
});
