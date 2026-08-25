import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { signSession } from "../../features/auth/server/session.server.ts";
import {
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

  after(async () => {
    await disposeTestD1();
  });
});
