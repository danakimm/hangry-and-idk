import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { D1Database, Clock, IdGenerator } from "../../server/db/types.server.ts";

let miniflareInstance: Miniflare | null = null;

export async function createTestD1(): Promise<D1Database> {
  if (!miniflareInstance) {
    miniflareInstance = new Miniflare({
      script: "export default { fetch() { return new Response('ok'); } }",
      modules: true,
      d1Databases: ["DB"],
    });
  }
  return miniflareInstance.getD1Database("DB");
}

export async function applyMigrations(db: D1Database): Promise<void> {
  const migrationPath = resolve(process.cwd(), "migrations/0001_users.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const prepared = statements.map((s) => db.prepare(s));
  await db.batch(prepared);
}

export async function disposeTestD1(): Promise<void> {
  if (miniflareInstance) {
    await miniflareInstance.dispose();
    miniflareInstance = null;
  }
}

export function createTestClock(initialSeconds = 1700000000): Clock & { advance(seconds: number): void } {
  let current = initialSeconds;
  return {
    nowSeconds() {
      return current;
    },
    advance(seconds: number) {
      current += seconds;
    },
  };
}

export function createTestIdGenerator(): IdGenerator & { setNext(uuid: string): void } {
  let nextUuid = "00000000-0000-0000-0000-000000000001";
  return {
    uuid() {
      return nextUuid;
    },
    setNext(uuid: string) {
      nextUuid = uuid;
    },
  };
}

export function createQueuedIdGenerator(queue: string[]): IdGenerator {
  let index = 0;
  return {
    uuid() {
      if (index >= queue.length) {
        throw new Error(`id generator queue exhausted (requested index ${index}, queue size ${queue.length})`);
      }
      return queue[index++];
    },
  };
}
