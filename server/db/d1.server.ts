import type { D1Database } from "./types.server.ts";

export type D1BindingCheck =
  | { ok: true; db: D1Database }
  | { ok: false; error: string };

export function checkD1Binding(db: D1Database | undefined): D1BindingCheck {
  if (!db) {
    return { ok: false, error: "D1 binding이 설정되지 않았습니다." };
  }
  return { ok: true, db };
}

export function requireD1Binding(db: D1Database | undefined): D1Database {
  const check = checkD1Binding(db);
  if (!check.ok) {
    throw new Error(check.error);
  }
  return check.db;
}

export function isD1NotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("not found") || error.message.includes("no such table");
  }
  return false;
}

export function normalizeD1Error(error: unknown): string {
  if (error instanceof Error) {
    if (isD1NotFoundError(error)) {
      return "요청한 데이터를 찾을 수 없습니다.";
    }
    if (error.message.includes("UNIQUE constraint failed")) {
      return "중복된 데이터가 존재합니다.";
    }
    return "데이터베이스 오류가 발생했습니다.";
  }
  return "알 수 없는 데이터베이스 오류가 발생했습니다.";
}
