import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  checkD1Binding,
  requireD1Binding,
  isD1NotFoundError,
  normalizeD1Error,
} from "../../server/db/d1.server.ts";
import type { D1Database } from "../../server/db/types.server.ts";

function createMockD1(): D1Database {
  return {
    prepare() {
      return {} as never;
    },
    batch() {
      return Promise.resolve([]);
    },
    exec() {
      return Promise.resolve({ count: 0, duration: 0 });
    },
  };
}

describe("D1 adapter", () => {
  test("checkD1Binding returns ok with valid binding", () => {
    const db = createMockD1();
    const result = checkD1Binding(db);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.db, db);
    }
  });

  test("checkD1Binding returns error with undefined binding", () => {
    const result = checkD1Binding(undefined);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /D1 binding/);
    }
  });

  test("requireD1Binding returns db with valid binding", () => {
    const db = createMockD1();
    const result = requireD1Binding(db);
    assert.equal(result, db);
  });

  test("requireD1Binding throws with undefined binding", () => {
    assert.throws(
      () => requireD1Binding(undefined),
      /D1 binding/,
    );
  });

  test("isD1NotFoundError identifies not found errors", () => {
    assert.equal(isD1NotFoundError(new Error("table not found")), true);
    assert.equal(isD1NotFoundError(new Error("no such table: users")), true);
    assert.equal(isD1NotFoundError(new Error("other error")), false);
    assert.equal(isD1NotFoundError("string error"), false);
  });

  test("normalizeD1Error returns user-friendly messages", () => {
    assert.equal(
      normalizeD1Error(new Error("not found")),
      "요청한 데이터를 찾을 수 없습니다.",
    );
    assert.equal(
      normalizeD1Error(new Error("UNIQUE constraint failed")),
      "중복된 데이터가 존재합니다.",
    );
    assert.equal(
      normalizeD1Error(new Error("other")),
      "데이터베이스 오류가 발생했습니다.",
    );
    assert.equal(
      normalizeD1Error("string"),
      "알 수 없는 데이터베이스 오류가 발생했습니다.",
    );
  });
});
