import { env } from "cloudflare:workers";
import {
  getSessionResponse,
  type AuthRuntimeEnv,
} from "@/lib/auth/session-api";

export async function GET(request: Request) {
  return getSessionResponse(request, env as AuthRuntimeEnv);
}
