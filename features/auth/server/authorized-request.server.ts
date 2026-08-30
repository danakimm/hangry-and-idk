import { checkD1Binding } from "../../../server/db/d1.server.ts";
import type { D1Database } from "../../../server/db/types.server.ts";
import { defaultClock, defaultIdGenerator } from "../../../server/db/types.server.ts";
import { apiError } from "../../../server/http/json.server.ts";
import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import { firebaseUidToRateLimitKey } from "./rate-limit-key.server.ts";
import { readSession } from "./session-api.server.ts";
import { createUserRepository } from "../../users/server/repository.server.ts";
import { createUserService } from "../../users/server/service.server.ts";

const RATE_LIMIT_RETRY_AFTER = 60;

type Options = {
  featureEnabled: boolean;
  invalidBodyCode: string;
  requireOrigin?: boolean;
  requireBody?: boolean;
  isMutation?: boolean;
};

export type AuthorizedRequestContext =
  | { ok: true; db: D1Database; internalUserId: string }
  | { ok: false; response: Response };

const error = (status: number, code: string, message: string): AuthorizedRequestContext => ({
  ok: false,
  response: apiError(status, code, message),
});

/** Shared guard for authenticated feature endpoints. Feature services remain responsible for domain behavior. */
export async function resolveAuthorizedRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  options: Options,
): Promise<AuthorizedRequestContext> {
  if (!options.featureEnabled) {
    return error(404, "FEATURE_DISABLED", "이 기능은 현재 사용할 수 없습니다.");
  }
  if (!runtimeEnv.AUTH_SESSION_SECRET) {
    return error(500, "SERVER_CONFIG_ERROR", "인증 서버 설정이 완료되지 않았습니다.");
  }
  if (options.requireOrigin) {
    if (!runtimeEnv.APP_ORIGIN) {
      return error(500, "SERVER_CONFIG_ERROR", "애플리케이션 origin이 설정되지 않았습니다.");
    }
    if (request.headers.get("Origin") !== runtimeEnv.APP_ORIGIN) {
      return error(403, "INVALID_ORIGIN", "요청이 허용되지 않습니다.");
    }
  }
  if (options.requireBody) {
    const mediaType = (request.headers.get("Content-Type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      return error(400, options.invalidBodyCode, "Content-Type이 올바르지 않습니다.");
    }
  }

  const session = await readSession(request, runtimeEnv);
  if (!session) return error(401, "UNAUTHORIZED", "로그인이 필요합니다.");

  const dbCheck = checkD1Binding(runtimeEnv.DB);
  if (!dbCheck.ok) {
    return error(500, "SERVER_CONFIG_ERROR", "데이터베이스 설정이 완료되지 않았습니다.");
  }
  const db = dbCheck.db;
  const userResult = await createUserService(
    createUserRepository({ db, clock: defaultClock, idGenerator: defaultIdGenerator }),
  ).ensureByFirebaseUid(session.subject);
  if (!userResult.ok) return error(500, "INTERNAL_ERROR", "사용자 생성에 실패했습니다.");

  if (options.isMutation) {
    if (!runtimeEnv.APP_WRITE_RATE_LIMITER) {
      return error(500, "SERVER_CONFIG_ERROR", "요청 제한 서비스 설정이 완료되지 않았습니다.");
    }
    try {
      const key = await firebaseUidToRateLimitKey(session.subject);
      const { success } = await runtimeEnv.APP_WRITE_RATE_LIMITER.limit({ key });
      if (!success) {
        return {
          ok: false,
          response: apiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", {
            "Retry-After": String(RATE_LIMIT_RETRY_AFTER),
          }),
        };
      }
    } catch {
      return error(503, "INTERNAL_ERROR", "요청 제한 서비스를 사용할 수 없습니다.");
    }
  }

  return { ok: true, db, internalUserId: userResult.user.id };
}
