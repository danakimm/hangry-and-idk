import { env } from "cloudflare:workers";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";
import {
  handleMenuSetCreateRequest,
  handleMenuSetListRequest,
} from "@/features/menu-sets/server/handlers.server";

export function GET(request: Request) {
  return handleMenuSetListRequest(request, env as AppRuntimeEnv);
}

export function POST(request: Request) {
  return handleMenuSetCreateRequest(request, env as AppRuntimeEnv);
}
