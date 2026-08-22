import assert from "node:assert/strict";
import test from "node:test";
import { firebaseUidToRateLimitKey } from "../../features/auth/server/rate-limit-key.server.ts";

test("produces deterministic key for same uid", async () => {
  const key1 = await firebaseUidToRateLimitKey("uid-abc");
  const key2 = await firebaseUidToRateLimitKey("uid-abc");
  assert.equal(key1, key2);
});

test("produces different keys for different uids", async () => {
  const key1 = await firebaseUidToRateLimitKey("uid-1");
  const key2 = await firebaseUidToRateLimitKey("uid-2");
  assert.notEqual(key1, key2);
});

test("key starts with restaurants:user:", async () => {
  const key = await firebaseUidToRateLimitKey("uid-abc");
  assert.ok(key.startsWith("restaurants:user:"));
});

test("key is a 64-char hex string after prefix", async () => {
  const key = await firebaseUidToRateLimitKey("uid-abc");
  const suffix = key.slice("restaurants:user:".length);
  assert.equal(suffix.length, 64);
  assert.match(suffix, /^[0-9a-f]{64}$/);
});
