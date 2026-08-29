import { env } from "cloudflare:workers";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";
import { handleMenuSetDefaultRequest } from "@/features/menu-sets/server/handlers.server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleMenuSetDefaultRequest(
    request,
    env as AppRuntimeEnv,
    (await params).id,
  );
}
