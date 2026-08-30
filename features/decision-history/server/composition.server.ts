import { checkD1Binding } from "../../../server/db/d1.server.ts";
import { defaultClock, defaultIdGenerator } from "../../../server/db/types.server.ts";
import { apiError } from "../../../server/http/json.server.ts";
import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import { isFeatureEnabled } from "../../../server/runtime-env.server.ts";
import { firebaseUidToRateLimitKey } from "../../auth/server/rate-limit-key.server.ts";
import { readSession } from "../../auth/server/session-api.server.ts";
import { createUserRepository } from "../../users/server/repository.server.ts";
import { createUserService } from "../../users/server/service.server.ts";
import { createDecisionHistoryRepository } from "./repository.server.ts";
import { createDecisionHistoryService } from "./service.server.ts";
import type { DecisionHistoryService } from "./service.server.ts";

const RATE_LIMIT_RETRY_AFTER = 60;

export type DecisionHistoryHandlerContext =
  | { ok: true; service: DecisionHistoryService; internalUserId: string }
  | { ok: false; response: Response };

function contextError(status: number, code: string, message: string) {
  return { ok: false as const, response: apiError(status, code, message) };
}

export async function resolveDecisionHistoryContext(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  options: { requireOrigin?: boolean; requireBody?: boolean; isMutation?: boolean } = {},
): Promise<DecisionHistoryHandlerContext> {
  if (!isFeatureEnabled(runtimeEnv.FEATURE_DECISION_HISTORY)) {
    return contextError(404, "FEATURE_DISABLED", "이 기능은 현재 사용할 수 없습니다.");
  }
  if (!runtimeEnv.AUTH_SESSION_SECRET) {
    return contextError(500, "SERVER_CONFIG_ERROR", "인증 서버 설정이 완료되지 않았습니다.");
  }
  if (options.requireOrigin) {
    if (!runtimeEnv.APP_ORIGIN) {
      return contextError(500, "SERVER_CONFIG_ERROR", "애플리케이션 origin이 설정되지 않았습니다.");
    }
    if (request.headers.get("Origin") !== runtimeEnv.APP_ORIGIN) {
      return contextError(403, "INVALID_ORIGIN", "요청이 허용되지 않습니다.");
    }
  }
  if (options.requireBody) {
    const mediaType = (request.headers.get("Content-Type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      return contextError(400, "INVALID_DECISION_HISTORY", "Content-Type이 올바르지 않습니다.");
    }
  }

  const session = await readSession(request, runtimeEnv);
  if (!session) {
    return contextError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  }

  const dbCheck = checkD1Binding(runtimeEnv.DB);
  if (!dbCheck.ok) {
    return contextError(500, "SERVER_CONFIG_ERROR", "데이터베이스 설정이 완료되지 않았습니다.");
  }
  const db = dbCheck.db;
  const userRepository = createUserRepository({
    db,
    clock: defaultClock,
    idGenerator: defaultIdGenerator,
  });
  const userResult = await createUserService(userRepository).ensureByFirebaseUid(
    session.subject,
  );
  if (!userResult.ok) {
    return contextError(500, "INTERNAL_ERROR", "사용자 생성에 실패했습니다.");
  }

  if (options.isMutation) {
    if (!runtimeEnv.APP_WRITE_RATE_LIMITER) {
      return contextError(500, "SERVER_CONFIG_ERROR", "요청 제한 서비스 설정이 완료되지 않았습니다.");
    }
    try {
      const key = await firebaseUidToRateLimitKey(session.subject);
      const { success } = await runtimeEnv.APP_WRITE_RATE_LIMITER.limit({ key });
      if (!success) {
        return {
          ok: false,
          response: apiError(
            429,
            "RATE_LIMITED",
            "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
            { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) },
          ),
        };
      }
    } catch {
      return contextError(503, "INTERNAL_ERROR", "요청 제한 서비스를 사용할 수 없습니다.");
    }
  }

  const service = createDecisionHistoryService({
    repository: createDecisionHistoryRepository({ db }),
    idGenerator: defaultIdGenerator,
    clock: defaultClock,
  });
  return { ok: true, service, internalUserId: userResult.user.id };
}

export function decisionHistoryErrorToHttp(code: string): number {
  switch (code) {
    case "INVALID_DECISION_HISTORY":
      return 400;
    case "DECISION_HISTORY_NOT_FOUND":
      return 404;
    default:
      return 500;
  }
}
