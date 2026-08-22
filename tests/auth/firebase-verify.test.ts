import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyFirebaseToken, resetKeyCache } from "../../features/auth/server/firebase-verify.server.ts";
import {
  createMockFirebaseToken,
  getTestKeysMap,
  PROJECT_ID,
} from "./helpers.ts";

let keysMap: Map<string, CryptoKey>;

test.before(async () => {
  keysMap = await getTestKeysMap();
});

test.afterEach(() => {
  resetKeyCache();
});

test("accepts a valid Firebase token", async () => {
  const token = await createMockFirebaseToken();
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
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
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
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

  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unsupported algorithm/);
  }
});

test("rejects token with unknown kid", async () => {
  const token = await createMockFirebaseToken({ kid: "unknown-kid" });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unknown kid/);
  }
});

test("rejects expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ exp: now - 100 });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("rejects token with wrong audience", async () => {
  const token = await createMockFirebaseToken({ aud: "wrong-project" });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("rejects token with wrong issuer", async () => {
  const token = await createMockFirebaseToken({
    iss: "https://securetoken.google.com/wrong-project",
  });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("rejects token with future iat", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ iat: now + 600 });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Token issued in the future/);
  }
});

test("rejects token with future auth_time", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ auth_time: now + 600 });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /auth_time is in the future/);
  }
});

test("rejects token with stale auth_time", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createMockFirebaseToken({ auth_time: now - 301 });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Authentication is too old/);
  }
});

test("rejects sub claim longer than a Firebase UID", async () => {
  const token = await createMockFirebaseToken({ sub: "u".repeat(129) });
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
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

  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
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
  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
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

  const { verifyTokenWithKeys } = await import("../../features/auth/server/firebase-verify.server.ts");
  const result = await verifyTokenWithKeys(token, PROJECT_ID, keysMap);
  assert.equal(result.ok, false);
});

test("verifies token through verifyFirebaseToken using X.509 certificate fetch", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "x509-test-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", join(tmpDir, "key.pem"),
      "-out", join(tmpDir, "cert.pem"),
      "-days", "1",
      "-subj", "/CN=test-firebase-cert",
    ], { stdio: "pipe" });

    const certPem = readFileSync(join(tmpDir, "cert.pem"), "utf8");
    const keyPem = readFileSync(join(tmpDir, "key.pem"), "utf8");

    const { importPKCS8, SignJWT } = await import("jose");
    const jwtPrivateKey = await importPKCS8(keyPem, "RS256");

    const testKid = "x509-test-kid";
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: "firebase-uid-456",
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      exp: now + 3600,
      iat: now,
      auth_time: now,
      email: "x509@example.com",
      name: "X509 User",
      firebase: { sign_in_provider: "google.com" },
    })
      .setProtectedHeader({ alg: "RS256", kid: testKid })
      .sign(jwtPrivateKey);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("googleapis.com") && url.includes("x509")) {
        return Response.json({ [testKid]: certPem }, {
          headers: { "Cache-Control": "max-age=3600" },
        });
      }
      return originalFetch(input);
    };

    try {
      const result = await verifyFirebaseToken(token, PROJECT_ID);
      assert.deepStrictEqual(result, {
        ok: true,
        uid: "firebase-uid-456",
        email: "x509@example.com",
        name: "X509 User",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("returns controlled error when public key fetch fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network timeout");
  };

  try {
    const token = await createMockFirebaseToken();
    const result = await verifyFirebaseToken(token, PROJECT_ID);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /network timeout/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
