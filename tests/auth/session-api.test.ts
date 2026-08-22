import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirebaseSessionResponse,
  createLogoutResponse,
  getSessionResponse,
  type AuthRuntimeEnv,
} from "../../features/auth/server/session-api.server.ts";
import { verifySession } from "../../features/auth/server/session.server.ts";

const APP_ORIGIN = "https://hangry-and-idk.site";
const SESSION_SECRET = "test-session-secret-that-is-long-enough-for-hmac";
const MOCK_ID_TOKEN = "mock-firebase-id-token";

const runtimeEnv: AuthRuntimeEnv = {
  APP_ORIGIN,
  AUTH_SESSION_SECRET: SESSION_SECRET,
  FIREBASE_PROJECT_ID: "test-project-id",
};

function sessionExchangeRequest(origin = APP_ORIGIN): Request {
  return new Request(`${APP_ORIGIN}/api/auth/firebase/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOCK_ID_TOKEN}`,
      Origin: origin,
    },
  });
}

test("exchanges a verified Firebase token for a secure session", async () => {
  let verifiedToken = "";
  let verifiedProjectId = "";
  const response = await createFirebaseSessionResponse(
    sessionExchangeRequest(),
    runtimeEnv,
    async (idToken, projectId) => {
      verifiedToken = idToken;
      verifiedProjectId = projectId;
      return {
        ok: true,
        uid: "firebase-uid-123",
        email: "user@example.com",
        name: "Test User",
      };
    },
  );

  assert.equal(response.status, 200);
  assert.equal(verifiedToken, MOCK_ID_TOKEN);
  assert.equal(verifiedProjectId, "test-project-id");
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const cookie = response.headers.get("Set-Cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const token = cookie.match(/omuo_session=([^;]+)/)?.[1];
  assert.ok(token);
  const session = await verifySession(token, SESSION_SECRET);
  assert.equal(session?.subject, "firebase-uid-123");
  assert.equal(session?.email, "user@example.com");

  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(MOCK_ID_TOKEN));
  assert.deepStrictEqual(JSON.parse(body), { ok: true });
});

test("rejects a session exchange from a different origin", async () => {
  let verifierCalled = false;
  const response = await createFirebaseSessionResponse(
    sessionExchangeRequest("https://example.com"),
    runtimeEnv,
    async () => {
      verifierCalled = true;
      return { ok: true, uid: "firebase-uid-123" };
    },
  );

  assert.equal(response.status, 403);
  assert.equal(verifierCalled, false);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("does not expose Firebase verification details", async () => {
  const response = await createFirebaseSessionResponse(
    sessionExchangeRequest(),
    runtimeEnv,
    async () => ({
      ok: false,
      error: `invalid token: ${MOCK_ID_TOKEN}`,
    }),
  );

  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), new RegExp(MOCK_ID_TOKEN));
});

test("returns the current user from a valid session cookie", async () => {
  const exchangeResponse = await createFirebaseSessionResponse(
    sessionExchangeRequest(),
    runtimeEnv,
    async () => ({
      ok: true,
      uid: "firebase-uid-123",
      email: "user@example.com",
      name: "Test User",
    }),
  );
  const cookie = exchangeResponse.headers.get("Set-Cookie") ?? "";

  const response = await getSessionResponse(
    new Request(`${APP_ORIGIN}/api/auth/session`, {
      headers: { Cookie: cookie },
    }),
    runtimeEnv,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.deepStrictEqual(await response.json(), {
    user: {
      email: "user@example.com",
      name: "Test User",
    },
  });
});

test("treats a missing or invalid session as logged out", async () => {
  const missingResponse = await getSessionResponse(
    new Request(`${APP_ORIGIN}/api/auth/session`),
    runtimeEnv,
  );
  assert.deepStrictEqual(await missingResponse.json(), { user: null });

  const invalidResponse = await getSessionResponse(
    new Request(`${APP_ORIGIN}/api/auth/session`, {
      headers: { Cookie: "omuo_session=invalid-token" },
    }),
    runtimeEnv,
  );
  assert.deepStrictEqual(await invalidResponse.json(), { user: null });
});

test("expires the session cookie on same-origin logout", async () => {
  const response = createLogoutResponse(
    new Request(`${APP_ORIGIN}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: APP_ORIGIN },
    }),
    runtimeEnv,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const cookie = response.headers.get("Set-Cookie") ?? "";
  assert.match(cookie, /omuo_session=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Secure/);
});

test("rejects cross-origin logout without clearing the cookie", () => {
  const response = createLogoutResponse(
    new Request(`${APP_ORIGIN}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: "https://example.com" },
    }),
    runtimeEnv,
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Set-Cookie"), null);
});
