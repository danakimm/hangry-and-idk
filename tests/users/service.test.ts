import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import {
  createTestD1,
  applyMigrations,
  disposeTestD1,
  createTestClock,
  createTestIdGenerator,
} from "./helpers.ts";
import { createUserRepository } from "../../features/users/server/repository.server.ts";
import { createUserService } from "../../features/users/server/service.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";

let db: D1Database;
const clock = createTestClock(1700000000);
const idGenerator = createTestIdGenerator();

describe("users service", async () => {
  db = await createTestD1();
  await applyMigrations(db);

  test("ensureByFirebaseUid creates user on first call", async () => {
    idGenerator.setNext("svc-uuid-001");
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.ensureByFirebaseUid("svc-firebase-uid-001");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "svc-uuid-001");
    }
  });

  test("ensureByFirebaseUid returns same user on second call", async () => {
    clock.advance(30);
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.ensureByFirebaseUid("svc-firebase-uid-001");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "svc-uuid-001");
      assert.equal(result.user.lastSeenAt, 1700000030);
    }
  });

  test("ensureByFirebaseUid fails with empty uid", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.ensureByFirebaseUid("");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Firebase UID/);
    }
  });

  test("getByFirebaseUid returns existing user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.getByFirebaseUid("svc-firebase-uid-001");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "svc-uuid-001");
    }
  });

  test("getByFirebaseUid fails for non-existent user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.getByFirebaseUid("non-existent-uid");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /찾을 수 없습니다/);
    }
  });

  test("getById returns existing user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.getById("svc-uuid-001");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "svc-uuid-001");
    }
  });

  test("getById fails for non-existent id", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.getById("non-existent-id");

    assert.equal(result.ok, false);
  });

  test("service result does not expose firebase_uid", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const result = await service.ensureByFirebaseUid("svc-firebase-uid-001");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal("firebase_uid" in result.user, false);
      assert.equal("firebaseUid" in result.user, false);
    }
  });

  after(async () => {
    await disposeTestD1();
  });
});
