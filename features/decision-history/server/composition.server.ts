import { defaultClock, defaultIdGenerator } from "../../../server/db/types.server.ts";
import type { AppRuntimeEnv } from "../../../server/runtime-env.server.ts";
import { isFeatureEnabled } from "../../../server/runtime-env.server.ts";
import { resolveAuthorizedRequest } from "../../auth/server/authorized-request.server.ts";
import { createDecisionHistoryRepository } from "./repository.server.ts";
import { createDecisionHistoryService } from "./service.server.ts";
import type { DecisionHistoryService } from "./service.server.ts";

export type DecisionHistoryHandlerContext =
  | { ok: true; service: DecisionHistoryService; internalUserId: string }
  | { ok: false; response: Response };

export async function resolveDecisionHistoryContext(
  request: Request,
  runtimeEnv: AppRuntimeEnv,
  options: { requireOrigin?: boolean; requireBody?: boolean; isMutation?: boolean } = {},
): Promise<DecisionHistoryHandlerContext> {
  const context = await resolveAuthorizedRequest(request, runtimeEnv, {
    featureEnabled: isFeatureEnabled(runtimeEnv.FEATURE_DECISION_HISTORY),
    invalidBodyCode: "INVALID_DECISION_HISTORY",
    ...options,
  });
  if (!context.ok) return context;

  const service = createDecisionHistoryService({
    repository: createDecisionHistoryRepository({ db: context.db }),
    idGenerator: defaultIdGenerator,
    clock: defaultClock,
  });
  return { ok: true, service, internalUserId: context.internalUserId };
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
