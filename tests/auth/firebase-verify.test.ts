import assert from "node:assert/strict";
import test from "node:test";
import { verifyTokenWithKeys } from "../../lib/auth/firebase-verify.ts";
import {
  createMockFirebaseToken,
  getTestKeysMap,
  PROJECT_ID,
} from "./helpers.ts";

let keysMap: Map<string, CryptoKey>;

test.before(async () => {
  keysMap = await getTestKeysMap();
});

test("accepts a valid Firebase token", async () => {
  const token = await createMockFirebaseToken();
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.deepStrictEqual(result, {
    ok: true,
    uid: "firebase-uid-123",
    email: undefined,
    name: undefined,
  });
});

test("extracts email and name claims", async () => {
  const token = await createMockFirebaseToken({
    email: "user@example.com",
    name: "Test User",
  });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.deepStrictEqual(result, {
    ok: true,
    uid: "firebase-uid-123",
    email: "user@example.com",
    name: "Test User",
  });
});

test("rejects token with wrong algorithm", async () => {
  const hmacKey = new TextEncoder().encode("test-hmac-key-for-algorithm-check");
  const now = Math.floor(Date.now() / 1000);
  const { SignJWT } = await import("jose");

  const token = await new SignJWT({
    sub: "uid",
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    exp: now + 3600,
    iat: now,
    auth_time: now,
    firebase: { sign_in_provider: "google.com" },
  })
    .setProtectedHeader({ alg: "HS256", kid: "test-kid-001" })
    .sign(hmacKey);

  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unsupported algorithm/);
  }
});

test("rejects token with unknown kid", async () => {
  const token = await createMockFirebaseToken({ kid: "unknown-kid" });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unknown kid/);
  }
});

test("rejects expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ exp: now - 100 });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});
test("rejects token with wrong audience", async () => {
  const token = await createMockFirebaseToken({ aud: "wrong-project" });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("rejects token with wrong issuer", async () => {
  const token = await createMockFirebaseToken({
    iss: "https://securetoken.google.com/wrong-project",
  });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("rejects token with future iat", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ iat: now + 600 });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Token issued in the future/);
  }
});

test("rejects token with future auth_time", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ auth_time: now + 600 });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /auth_time is in the future/);
  }
});

test("rejects token with stale auth_time", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ auth_time: now - 301 });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Authentication is too old/);
  }
});

test("rejects sub claim longer than a Firebase UID", async () => {
  const token = await createMockFirebaseToken({ sub: "u".repeat(129) });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Missing required Firebase claims/);
  }
});

test("rejects token with missing sub claim", async () => {
  const keys = await import("./helpers.ts").then((m) => m.generateTestKeys());
  const { SignJWT } = await import("jose");
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    exp: now + 3600,
    iat: now,
    auth_time: now,
    firebase: { sign_in_provider: "google.com" },
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid-001" })
    .sign(keys.privateKey);

  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Missing required Firebase claims/);
  }
});

test("rejects non-google provider", async () => {
  const token = await createMockFirebaseToken({
    firebase: { sign_in_provider: "password" },
  });
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unsupported provider/);
  }
});

test("rejects token signed with wrong key", async () => {
  const { generateKeyPair, SignJWT } = await import("jose");
  const { privateKey } = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    sub: "uid",
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    exp: now + 3600,
    iat: now,
    auth_time: now,
    firebase: { sign_in_provider: "google.com" },
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid-001" })
    .sign(privateKey);

  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});
