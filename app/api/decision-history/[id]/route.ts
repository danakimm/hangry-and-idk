import { env } from "cloudflare:workers";
import { handleDecisionHistoryDeleteRequest } from "@/features/decision-history/server/handlers.server";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleDecisionHistoryDeleteRequest(
    request,
    env as AppRuntimeEnv,
    (await params).id,
  );
}
