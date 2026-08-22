import { env } from "cloudflare:workers";
import {
  createLogoutResponse,
  type AuthRuntimeEnv,
} from "@/features/auth/server/session-api.server";

export async function POST(request: Request) {
  return createLogoutResponse(request, env as AuthRuntimeEnv);
}
