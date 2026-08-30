import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import { isFeatureEnabled } from "../../../server/runtime-env.server.ts";
import { apiError } from "../../../server/http/json.server.ts";
import { readSession } from "../../auth/server/session-api.server.ts";
import { createUserService } from "../../users/server/service.server.ts";
import { createUserRepository } from "../../users/server/repository.server.ts";
import { checkD1Binding } from "../../../server/db/d1.server.ts";
import { defaultClock, defaultIdGenerator } from "../../../server/db/types.server.ts";
import { createMenuSetRepository } from "./repository.server.ts";
import { createMenuSetService } from "./service.server.ts";
import type { MenuSetService } from "./service.server.ts";
import { firebaseUidToRateLimitKey } from "../../auth/server/rate-limit-key.server.ts";
import { readJsonBody } from "../../../server/http/body.server.ts";

const RATE_LIMIT_RETRY_AFTER = 60;
const MAX_BODY_BYTES = 50_000;

export type MenuSetHandlerContext =
  | { ok: true; service: MenuSetService; internalUserId: string }
  | { ok: false; response: Response };

export async function resolveMenuSetContext(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  options: { requireOrigin?: boolean; requireBody?: boolean; isMutation?: boolean } = {},
): Promise<MenuSetHandlerContext> {
  if (!isFeatureEnabled(runtimeEnv.FEATURE_MENU_SETS)) {
    return {
      ok: false,
      response: apiError(404, "FEATURE_DISABLED", "이 기능은 현재 사용할 수 없습니다."),
    };
  }

  if (!runtimeEnv.AUTH_SESSION_SECRET) {
    return {
      ok: false,
      response: apiError(500, "SERVER_CONFIG_ERROR", "인증 서버 설정이 완료되지 않았습니다."),
    };
  }

  if (options.requireOrigin) {
    if (!runtimeEnv.APP_ORIGIN) {
      return {
        ok: false,
        response: apiError(500, "SERVER_CONFIG_ERROR", "애플리케이션 origin이 설정되지 않았습니다."),
      };
    }
    if (request.headers.get("Origin") !== runtimeEnv.APP_ORIGIN) {
      return {
        ok: false,
        response: apiError(403, "INVALID_ORIGIN", "요청이 허용되지 않습니다."),
      };
    }
  }

  if (options.requireBody) {
    const contentType = request.headers.get("Content-Type") ?? "";
    const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return {
        ok: false,
        response: apiError(400, "INVALID_MENU_SET", "Content-Type이 올바르지 않습니다."),
      };
    }
  }

  const session = await readSession(request, runtimeEnv);
  if (!session) {
    return {
      ok: false,
      response: apiError(401, "UNAUTHORIZED", "로그인이 필요합니다."),
    };
  }

  const dbCheck = checkD1Binding(runtimeEnv.DB);
  if (!dbCheck.ok) {
    return {
      ok: false,
      response: apiError(500, "SERVER_CONFIG_ERROR", "데이터베이스 설정이 완료되지 않았습니다."),
    };
  }
  const db = dbCheck.db;

  const userRepo = createUserRepository({ db, clock: defaultClock, idGenerator: defaultIdGenerator });
  const userService = createUserService(userRepo);
  const userResult = await userService.ensureByFirebaseUid(session.subject);
  if (!userResult.ok) {
    return {
      ok: false,
      response: apiError(500, "INTERNAL_ERROR", "사용자 생성에 실패했습니다."),
    };
  }

  if (options.isMutation) {
    if (!runtimeEnv.APP_WRITE_RATE_LIMITER) {
      return {
        ok: false,
        response: apiError(500, "SERVER_CONFIG_ERROR", "요청 제한 서비스 설정이 완료되지 않았습니다."),
      };
    }
    const rateLimitKey = await firebaseUidToRateLimitKey(session.subject);
    try {
      const { success } = await runtimeEnv.APP_WRITE_RATE_LIMITER.limit({ key: rateLimitKey });
      if (!success) {
        return {
          ok: false,
          response: apiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", {
            "Retry-After": String(RATE_LIMIT_RETRY_AFTER),
          }),
        };
      }
    } catch {
      return {
        ok: false,
        response: apiError(503, "INTERNAL_ERROR", "요청 제한 서비스를 사용할 수 없습니다."),
      };
    }
  }

  const menuSetRepo = createMenuSetRepository({ db, clock: defaultClock, idGenerator: defaultIdGenerator });
  const menuSetService = createMenuSetService({
    repository: menuSetRepo,
    idGenerator: defaultIdGenerator,
    clock: defaultClock,
  });

  return { ok: true, service: menuSetService, internalUserId: userResult.user.id };
}

export function serviceErrorToHttp(code: string): number {
  switch (code) {
    case "UNAUTHORIZED": return 401;
    case "MENU_SET_NOT_FOUND": return 404;
    case "MENU_SET_LIMIT_REACHED": return 409;
    case "MENU_SET_VERSION_CONFLICT": return 409;
    case "DUPLICATE_MENU_NAME": return 409;
    case "INVALID_MENU_SET": return 400;
    case "FEATURE_DISABLED": return 404;
    case "SERVER_CONFIG_ERROR": return 500;
    case "RATE_LIMITED": return 429;
    case "INVALID_ORIGIN": return 403;
    default: return 500;
  }
}

export async function parseBody<T>(request: Request): Promise<T | null> {
  return readJsonBody<T>(request, MAX_BODY_BYTES);
}
