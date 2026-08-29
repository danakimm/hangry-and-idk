import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import {
  apiError,
  json,
  preventClientCaching,
} from "../../../server/http/json.server.ts";
import {
  parseBody,
  resolveMenuSetContext,
  serviceErrorToHttp,
} from "./composition.server.ts";
import {
  mapMenuSetListToResponse,
  mapMenuSetToResponse,
} from "./mapper.server.ts";
import {
  isJsonObject,
  parseArchiveMenuSetCommand,
  parseCreateMenuSetCommand,
  parseUpdateMenuSetCommand,
} from "./request.server.ts";

function privateResponse(response: Response): Response {
  return preventClientCaching(response);
}

function invalidRequest(): Response {
  return privateResponse(
    apiError(400, "INVALID_MENU_SET", "요청 형식이 올바르지 않습니다."),
  );
}

function serviceError(code: string, message: string): Response {
  return privateResponse(
    apiError(serviceErrorToHttp(code), code, message),
  );
}

function internalError(): Response {
  return privateResponse(
    apiError(500, "INTERNAL_ERROR", "요청 처리에 실패했습니다."),
  );
}

export async function handleMenuSetListRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv);
    if (!context.ok) return privateResponse(context.response);
    const result = await context.service.list(context.internalUserId);
    return result.ok
      ? privateResponse(json(mapMenuSetListToResponse(result.data), 200))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleMenuSetCreateRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv, {
      requireOrigin: true,
      requireBody: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const command = parseCreateMenuSetCommand(await parseBody<unknown>(request));
    if (!command) return invalidRequest();
    const result = await context.service.create(context.internalUserId, command);
    return result.ok
      ? privateResponse(json(mapMenuSetToResponse(result.data), 201))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleMenuSetGetRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  menuSetId: string,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv);
    if (!context.ok) return privateResponse(context.response);
    const result = await context.service.get(menuSetId, context.internalUserId);
    return result.ok
      ? privateResponse(json(mapMenuSetToResponse(result.data), 200))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleMenuSetUpdateRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  menuSetId: string,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv, {
      requireOrigin: true,
      requireBody: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const command = parseUpdateMenuSetCommand(await parseBody<unknown>(request));
    if (!command) return invalidRequest();
    const result = await context.service.update(
      menuSetId,
      context.internalUserId,
      command,
    );
    return result.ok
      ? privateResponse(json(mapMenuSetToResponse(result.data), 200))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleMenuSetArchiveRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  menuSetId: string,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv, {
      requireOrigin: true,
      requireBody: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const command = parseArchiveMenuSetCommand(await parseBody<unknown>(request));
    if (!command) return invalidRequest();
    const result = await context.service.archive(
      menuSetId,
      context.internalUserId,
      command,
    );
    return result.ok
      ? privateResponse(json({ ok: true }, 200))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleMenuSetDefaultRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  menuSetId: string,
): Promise<Response> {
  try {
    const context = await resolveMenuSetContext(request, runtimeEnv, {
      requireOrigin: true,
      requireBody: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    if (!isJsonObject(await parseBody<unknown>(request))) {
      return invalidRequest();
    }
    const result = await context.service.setDefault(
      menuSetId,
      context.internalUserId,
    );
    return result.ok
      ? privateResponse(json(mapMenuSetToResponse(result.data), 200))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}
