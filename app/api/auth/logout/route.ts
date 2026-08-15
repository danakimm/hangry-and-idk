import { env } from "cloudflare:workers";
import {
  createLogoutResponse,
  type AuthRuntimeEnv,
} from "@/lib/auth/session-api";

export async function POST(request: Request) {
  return createLogoutResponse(request, env as AuthRuntimeEnv);
}
