import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
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

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "'" ) {
      current += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i];
        current += c;
        i++;
        if (c === "'" ) {
          if (sql[i] === "'" ) { current += sql[i]; i++; continue; }
          break;
        }
      }
      continue;
    }
    const upper = sql.slice(i).toUpperCase();
    if (upper.startsWith("BEGIN")) { depth++; current += "BEGIN"; i += 5; continue; }
    if (upper.startsWith("END")) { depth--; current += "END"; i += 3; continue; }
    if (ch === ";" && depth <= 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

export async function applyMigrations(db: D1Database): Promise<void> {
  const migrationsDir = resolve(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await applyMigrationFiles(db, files);
}

export async function applyMigrationFiles(
  db: D1Database,
  files: string[],
): Promise<void> {
  const migrationsDir = resolve(process.cwd(), "migrations");

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
    const statements = splitSqlStatements(sql);

    const prepared = statements.map((s) => db.prepare(s));
    await db.batch(prepared);
  }
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
