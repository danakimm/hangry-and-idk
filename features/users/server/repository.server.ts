import type {
  D1Database,
  Clock,
  IdGenerator,
} from "../../../server/db/types.server.ts";
import { normalizeD1Error } from "../../../server/db/d1.server.ts";

export type UserRow = {
  id: string;
  firebase_uid: string;
  created_at: number;
  last_seen_at: number;
};

export type UserRepository = {
  findByFirebaseUid(firebaseUid: string): Promise<UserRow | null>;
  findById(userId: string): Promise<UserRow | null>;
  upsert(firebaseUid: string): Promise<UserRow>;
};

export type UserRepositoryDependencies = {
  db: D1Database;
  clock: Clock;
  idGenerator: IdGenerator;
};

export function createUserRepository(
  deps: UserRepositoryDependencies,
): UserRepository {
  return {
    async findByFirebaseUid(firebaseUid: string): Promise<UserRow | null> {
      try {
        const row = await deps.db
          .prepare(
            "SELECT id, firebase_uid, created_at, last_seen_at FROM users WHERE firebase_uid = ?",
          )
          .bind(firebaseUid)
          .first<UserRow>();
        return row ?? null;
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async findById(userId: string): Promise<UserRow | null> {
      try {
        const row = await deps.db
          .prepare(
            "SELECT id, firebase_uid, created_at, last_seen_at FROM users WHERE id = ?",
          )
          .bind(userId)
          .first<UserRow>();
        return row ?? null;
      } catch (error) {
        throw new Error(normalizeD1Error(error));
      }
    },

    async upsert(firebaseUid: string): Promise<UserRow> {
      const now = deps.clock.nowSeconds();
      const existing = await this.findByFirebaseUid(firebaseUid);

      if (existing) {
        try {
          await deps.db
            .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
            .bind(now, existing.id)
            .run();
          return { ...existing, last_seen_at: now };
        } catch (error) {
          throw new Error(normalizeD1Error(error));
        }
      }

      const id = deps.idGenerator.uuid();
      try {
        await deps.db
          .prepare(
            "INSERT INTO users (id, firebase_uid, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
          )
          .bind(id, firebaseUid, now, now)
          .run();
        return { id, firebase_uid: firebaseUid, created_at: now, last_seen_at: now };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("UNIQUE constraint failed")
        ) {
          const retry = await this.findByFirebaseUid(firebaseUid);
          if (retry) {
            try {
              await deps.db
                .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
                .bind(now, retry.id)
                .run();
              return { ...retry, last_seen_at: now };
            } catch (updateError) {
              throw new Error(normalizeD1Error(updateError));
            }
          }
        }
        throw new Error(normalizeD1Error(error));
      }
    },
  };
}
