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
import { createCurrentUserResolver } from "../../features/auth/server/current-user.server.ts";
import { signSession } from "../../features/auth/server/session.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";

let db: D1Database;
const clock = createTestClock(1700000000);
const idGenerator = createTestIdGenerator();
const SESSION_SECRET = "test-session-secret-for-current-user-test";
const APP_ORIGIN = "https://hangry-and-idk.site";

const runtimeEnv = {
  APP_ORIGIN,
  AUTH_SESSION_SECRET: SESSION_SECRET,
  FIREBASE_PROJECT_ID: "test-project-id",
};

describe("current-user helper", async () => {
  db = await createTestD1();
  await applyMigrations(db);

  test("resolveCurrentUser creates user from valid session", async () => {
    idGenerator.setNext("cu-uuid-001");
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const token = await signSession(
      {
        provider: "firebase",
        subject: "cu-firebase-uid-001",
        email: "test@example.com",
        name: "Test User",
      },
      SESSION_SECRET,
    );

    const request = new Request(`${APP_ORIGIN}/api/test`, {
      headers: { Cookie: `omuo_session=${token}` },
    });

    const result = await resolveCurrentUser(request, runtimeEnv);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.internalUserId, "cu-uuid-001");
      assert.equal(result.session.subject, "cu-firebase-uid-001");
    }
  });

  test("resolveCurrentUser returns same user on second request", async () => {
    clock.advance(45);
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const token = await signSession(
      {
        provider: "firebase",
        subject: "cu-firebase-uid-001",
      },
      SESSION_SECRET,
    );

    const request = new Request(`${APP_ORIGIN}/api/test`, {
      headers: { Cookie: `omuo_session=${token}` },
    });

    const result = await resolveCurrentUser(request, runtimeEnv);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.internalUserId, "cu-uuid-001");
    }
  });

  test("resolveCurrentUser fails without session", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const request = new Request(`${APP_ORIGIN}/api/test`);
    const result = await resolveCurrentUser(request, runtimeEnv);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /로그인/);
    }
  });

  test("resolveCurrentUser fails with invalid session", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const request = new Request(`${APP_ORIGIN}/api/test`, {
      headers: { Cookie: "omuo_session=invalid-token" },
    });

    const result = await resolveCurrentUser(request, runtimeEnv);

    assert.equal(result.ok, false);
  });

  test("resolveCurrentUser fails without AUTH_SESSION_SECRET", async () => {
    const repo = createUserRepository({ db, clock, idGenerator });
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const token = await signSession(
      { provider: "firebase", subject: "test" },
      SESSION_SECRET,
    );

    const request = new Request(`${APP_ORIGIN}/api/test`, {
      headers: { Cookie: `omuo_session=${token}` },
    });

    const result = await resolveCurrentUser(
      request,
      { ...runtimeEnv, AUTH_SESSION_SECRET: undefined },
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /인증 서버 설정/);
    }
  });

  test("resolveCurrentUser fails safely when DB binding is missing", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("Cannot read properties of undefined (reading 'prepare')");
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
    const service = createUserService(repo);
    const resolveCurrentUser = createCurrentUserResolver(service);

    const token = await signSession(
      { provider: "firebase", subject: "test-uid" },
      SESSION_SECRET,
    );

    const request = new Request(`${APP_ORIGIN}/api/test`, {
      headers: { Cookie: `omuo_session=${token}` },
    });

    const result = await resolveCurrentUser(request, runtimeEnv);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.error, /Cannot read properties/);
      assert.doesNotMatch(result.error, /undefined/);
    }
  });

  after(async () => {
    await disposeTestD1();
  });
});
