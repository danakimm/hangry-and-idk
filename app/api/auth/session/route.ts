import { env } from "cloudflare:workers";
import {
  getSessionResponse,
  type AuthRuntimeEnv,
} from "@/features/auth/server/session-api.server";

export async function GET(request: Request) {
  return getSessionResponse(request, env as AuthRuntimeEnv);
}
