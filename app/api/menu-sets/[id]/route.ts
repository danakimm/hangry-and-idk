import { env } from "cloudflare:workers";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";
import {
  handleMenuSetArchiveRequest,
  handleMenuSetGetRequest,
  handleMenuSetUpdateRequest,
} from "@/features/menu-sets/server/handlers.server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return handleMenuSetGetRequest(
    request,
    env as AppRuntimeEnv,
    (await params).id,
  );
}

export async function PUT(request: Request, { params }: RouteContext) {
  return handleMenuSetUpdateRequest(
    request,
    env as AppRuntimeEnv,
    (await params).id,
  );
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleMenuSetArchiveRequest(
    request,
    env as AppRuntimeEnv,
    (await params).id,
  );
}
