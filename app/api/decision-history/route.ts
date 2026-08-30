import { env } from "cloudflare:workers";
import {
  handleDecisionHistoryCreateRequest,
  handleDecisionHistoryDeleteAllRequest,
  handleDecisionHistoryListRequest,
} from "@/features/decision-history/server/handlers.server";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";

export function GET(request: Request) {
  return handleDecisionHistoryListRequest(request, env as AppRuntimeEnv);
}

export function POST(request: Request) {
  return handleDecisionHistoryCreateRequest(request, env as AppRuntimeEnv);
}

export function DELETE(request: Request) {
  return handleDecisionHistoryDeleteAllRequest(request, env as AppRuntimeEnv);
}
