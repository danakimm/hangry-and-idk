import assert from "node:assert/strict";
import test, { describe, after } from "node:test";
import {
  createTestD1,
  applyMigrations,
  disposeTestD1,
  createTestClock,
  createTestIdGenerator,
  createQueuedIdGenerator,
} from "./helpers.ts";
import { createUserRepository } from "../../features/users/server/repository.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";

let db: D1Database;
const clock = createTestClock(1700000000);
const idGenerator = createTestIdGenerator();

describe("users repository", async () => {
  db = await createTestD1();
  await applyMigrations(db);

  test("findByFirebaseUid returns null for non-existent user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const result = await repo.findByFirebaseUid("non-existent-uid");
    assert.equal(result, null);
  });

  test("upsert creates a new user on first request", async () => {
    idGenerator.setNext("user-uuid-001");
    const repo = createUserRepository({ db, clock, idGenerator });
    const user = await repo.upsert("firebase-uid-001");

    assert.equal(user.id, "user-uuid-001");
    assert.equal(user.firebase_uid, "firebase-uid-001");
    assert.equal(user.created_at, 1700000000);
    assert.equal(user.last_seen_at, 1700000000);
  });

  test("findByFirebaseUid returns existing user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const result = await repo.findByFirebaseUid("firebase-uid-001");

    assert.notEqual(result, null);
    assert.equal(result!.id, "user-uuid-001");
    assert.equal(result!.firebase_uid, "firebase-uid-001");
  });

  test("findById returns existing user", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const result = await repo.findById("user-uuid-001");

    assert.notEqual(result, null);
    assert.equal(result!.id, "user-uuid-001");
    assert.equal(result!.firebase_uid, "firebase-uid-001");
  });

  test("upsert updates last_seen_at on existing user", async () => {
    clock.advance(60);
    const repo = createUserRepository({ db, clock, idGenerator });
    const user = await repo.upsert("firebase-uid-001");

    assert.equal(user.id, "user-uuid-001");
    assert.equal(user.created_at, 1700000000);
    assert.equal(user.last_seen_at, 1700000060);
  });

  test("different Firebase UIDs create different users", async () => {
    idGenerator.setNext("user-uuid-002");
    const repo = createUserRepository({ db, clock, idGenerator });
    const user2 = await repo.upsert("firebase-uid-002");

    assert.equal(user2.id, "user-uuid-002");
    assert.equal(user2.firebase_uid, "firebase-uid-002");

    const user1 = await repo.findByFirebaseUid("firebase-uid-001");
    assert.notEqual(user1, null);
    assert.equal(user1!.id, "user-uuid-001");
  });

  test("concurrent upsert maintains single user per firebase_uid", async () => {
    const queuedGen = createQueuedIdGenerator([
      "user-uuid-003a",
      "user-uuid-003b",
      "user-uuid-003c",
    ]);
    const repo = createUserRepository({ db, clock, idGenerator: queuedGen });

    const results = await Promise.all([
      repo.upsert("firebase-uid-003"),
      repo.upsert("firebase-uid-003"),
      repo.upsert("firebase-uid-003"),
    ]);

    const ids = results.map((r) => r.id);
    const uniqueIds = new Set(ids);
    assert.equal(
      uniqueIds.size,
      1,
      `All concurrent upserts should return the same user, got: ${ids.join(", ")}`,
    );

    const count = await db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE firebase_uid = ?")
      .bind("firebase-uid-003")
      .first<{ cnt: number }>();
    assert.equal(count?.cnt, 1, "Exactly one row should exist for firebase_uid-003");
  });

  test("findById returns null for non-existent id", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const result = await repo.findById("non-existent-id");
    assert.equal(result, null);
  });

  test("repository normalizes D1 errors", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("no such table: users");
      },
      batch() {
        return Promise.resolve([]);
      },
      exec() {
        return Promise.resolve({ count: 0, duration: 0 });
      },
    };
    const repo = createUserRepository({
      db: brokenDb,
      clock,
      idGenerator,
    });

    await assert.rejects(
      () => repo.findByFirebaseUid("test"),
      (error: Error) => {
        assert.equal(error.message, "요청한 데이터를 찾을 수 없습니다.");
        return true;
      },
    );
  });

  after(async () => {
    await disposeTestD1();
  });
});
