import type { UserRepository } from "./repository.server.ts";

export type InternalUser = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
};

export type UserServiceResult =
  | { ok: true; user: InternalUser }
  | { ok: false; error: string };

export type UserService = {
  ensureByFirebaseUid(firebaseUid: string): Promise<UserServiceResult>;
  getByFirebaseUid(firebaseUid: string): Promise<UserServiceResult>;
  getById(userId: string): Promise<UserServiceResult>;
};

export function createUserService(
  repo: UserRepository,
): UserService {
  return {
    async ensureByFirebaseUid(firebaseUid: string): Promise<UserServiceResult> {
      if (!firebaseUid) {
        return { ok: false, error: "Firebase UID가 필요합니다." };
      }

      try {
        const row = await repo.upsert(firebaseUid);
        return {
          ok: true,
          user: {
            id: row.id,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
          },
        };
      } catch {
        return { ok: false, error: "사용자 생성에 실패했습니다." };
      }
    },

    async getByFirebaseUid(firebaseUid: string): Promise<UserServiceResult> {
      if (!firebaseUid) {
        return { ok: false, error: "Firebase UID가 필요합니다." };
      }

      try {
        const row = await repo.findByFirebaseUid(firebaseUid);
        if (!row) {
          return { ok: false, error: "사용자를 찾을 수 없습니다." };
        }
        return {
          ok: true,
          user: {
            id: row.id,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
          },
        };
      } catch {
        return { ok: false, error: "사용자 조회에 실패했습니다." };
      }
    },

    async getById(userId: string): Promise<UserServiceResult> {
      if (!userId) {
        return { ok: false, error: "사용자 ID가 필요합니다." };
      }

      try {
        const row = await repo.findById(userId);
        if (!row) {
          return { ok: false, error: "사용자를 찾을 수 없습니다." };
        }
        return {
          ok: true,
          user: {
            id: row.id,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
          },
        };
      } catch {
        return { ok: false, error: "사용자 조회에 실패했습니다." };
      }
    },
  };
}
