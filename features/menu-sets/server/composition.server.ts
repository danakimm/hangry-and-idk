import { defaultClock, defaultIdGenerator } from "../../../server/db/types.server.ts";
import { readJsonBody } from "../../../server/http/body.server.ts";
import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import { isFeatureEnabled } from "../../../server/runtime-env.server.ts";
import { resolveAuthorizedRequest } from "../../auth/server/authorized-request.server.ts";
import { createMenuSetRepository } from "./repository.server.ts";
import { createMenuSetService } from "./service.server.ts";
import type { MenuSetService } from "./service.server.ts";

const MAX_BODY_BYTES = 50_000;

export type MenuSetHandlerContext =
  | { ok: true; service: MenuSetService; internalUserId: string }
  | { ok: false; response: Response };

export async function resolveMenuSetContext(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  options: { requireOrigin?: boolean; requireBody?: boolean; isMutation?: boolean } = {},
): Promise<MenuSetHandlerContext> {
  const context = await resolveAuthorizedRequest(request, runtimeEnv, {
    featureEnabled: isFeatureEnabled(runtimeEnv.FEATURE_MENU_SETS),
    invalidBodyCode: "INVALID_MENU_SET",
    ...options,
  });
  if (!context.ok) return context;

  const service = createMenuSetService({
    repository: createMenuSetRepository({
      db: context.db,
      clock: defaultClock,
      idGenerator: defaultIdGenerator,
    }),
    idGenerator: defaultIdGenerator,
    clock: defaultClock,
  });
  return { ok: true, service, internalUserId: context.internalUserId };
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
