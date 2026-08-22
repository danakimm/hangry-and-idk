import assert from "node:assert/strict";
import test from "node:test";
import {
  signSession,
  verifySession,
  buildSessionCookie,
  buildLogoutCookie,
  getSessionCookieName,
  SESSION_MAX_AGE_SECONDS,
} from "../../features/auth/server/session.server.ts";

const TEST_SECRET = "test-session-secret-that-is-long-enough-for-hmac";

test("signs and verifies a valid session", async () => {
  const token = await signSession(
    { provider: "firebase", subject: "uid-123", email: "a@b.com" },
    TEST_SECRET,
  );

  const payload = await verifySession(token, TEST_SECRET);
  assert.ok(payload);
  assert.equal(payload.provider, "firebase");
  assert.equal(payload.subject, "uid-123");
  assert.equal(payload.email, "a@b.com");
  assert.equal(typeof payload.issuedAt, "number");
  assert.equal(typeof payload.expiresAt, "number");
  assert.ok(payload.expiresAt > payload.issuedAt);
});

test("rejects session signed with wrong secret", async () => {
  const token = await signSession(
    { provider: "firebase", subject: "uid-123" },
    TEST_SECRET,
  );

  const payload = await verifySession(token, "wrong-secret");
  assert.equal(payload, null);
});

test("rejects expired session", async () => {
  const { SignJWT } = await import("jose");

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    provider: "firebase",
    subject: "uid-123",
    issuedAt: now - 200,
    expiresAt: now - 100,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now - 200)
    .setExpirationTime("0s")
    .sign(new TextEncoder().encode(TEST_SECRET));

  const payload = await verifySession(token, TEST_SECRET);
  assert.equal(payload, null);
});

test("rejects tampered session payload", async () => {
  const token = await signSession(
    { provider: "firebase", subject: "uid-123" },
    TEST_SECRET,
  );

  const parts = token.split(".");
  const payloadBytes = Buffer.from(parts[1], "base64url");
  const payload = JSON.parse(payloadBytes.toString());
  payload.subject = "uid-tampered";
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const tampered = parts.join(".");

  const result = await verifySession(tampered, TEST_SECRET);
  assert.equal(result, null);
});

test("builds correct session cookie", () => {
  const cookie = buildSessionCookie("token-value", true);
  assert.match(cookie, /omuo_session=token-value/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=86400/);
});

test("builds session cookie without Secure in non-secure mode", () => {
  const cookie = buildSessionCookie("token-value", false);
  assert.doesNotMatch(cookie, /Secure/);
});

test("builds logout cookie with zero max-age", () => {
  const cookie = buildLogoutCookie(true);
  assert.match(cookie, /omuo_session=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Secure/);
});

test("session cookie name is omuo_session", () => {
  assert.equal(getSessionCookieName(), "omuo_session");
});

test("session max age is 24 hours", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 86400);
});
