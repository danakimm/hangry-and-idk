import { readJsonBody } from "../../../server/http/body.server.ts";
import {
  apiError,
  json,
  preventClientCaching,
} from "../../../server/http/json.server.ts";
import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import {
  decisionHistoryErrorToHttp,
  resolveDecisionHistoryContext,
} from "./composition.server.ts";
import {
  mapDecisionHistoryListToResponse,
  mapDecisionHistoryToResponse,
} from "./mapper.server.ts";
import { parseCreateDecisionCommand } from "./request.server.ts";

const MAX_BODY_BYTES = 10_000;
const privateResponse = (response: Response) => preventClientCaching(response);
const internalError = () =>
  privateResponse(apiError(500, "INTERNAL_ERROR", "요청 처리에 실패했습니다."));
const invalidRequest = () =>
  privateResponse(
    apiError(400, "INVALID_DECISION_HISTORY", "요청 형식이 올바르지 않습니다."),
  );
const serviceError = (code: string, message: string) =>
  privateResponse(apiError(decisionHistoryErrorToHttp(code), code, message));

export async function handleDecisionHistoryListRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
): Promise<Response> {
  try {
    const context = await resolveDecisionHistoryContext(request, runtimeEnv);
    if (!context.ok) return privateResponse(context.response);
    const result = await context.service.list(context.internalUserId);
    return result.ok
      ? privateResponse(json(mapDecisionHistoryListToResponse(result.data)))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleDecisionHistoryCreateRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
): Promise<Response> {
  try {
    const context = await resolveDecisionHistoryContext(request, runtimeEnv, {
      requireOrigin: true,
      requireBody: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const command = parseCreateDecisionCommand(
      await readJsonBody<unknown>(request, MAX_BODY_BYTES),
    );
    if (!command) return invalidRequest();
    const result = await context.service.create(context.internalUserId, command);
    return result.ok
      ? privateResponse(
          json(
            {
              decision: mapDecisionHistoryToResponse(result.data.record),
              created: result.data.created,
            },
            result.data.created ? 201 : 200,
          ),
        )
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleDecisionHistoryDeleteRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  id: string,
): Promise<Response> {
  try {
    const context = await resolveDecisionHistoryContext(request, runtimeEnv, {
      requireOrigin: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const result = await context.service.deleteOne(id, context.internalUserId);
    return result.ok
      ? privateResponse(json({ ok: true }))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}

export async function handleDecisionHistoryDeleteAllRequest(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
): Promise<Response> {
  try {
    const context = await resolveDecisionHistoryContext(request, runtimeEnv, {
      requireOrigin: true,
      isMutation: true,
    });
    if (!context.ok) return privateResponse(context.response);
    const result = await context.service.deleteAll(context.internalUserId);
    return result.ok
      ? privateResponse(json({ deletedCount: result.data.deletedCount }))
      : serviceError(result.error.code, result.error.message);
  } catch {
    return internalError();
  }
}
