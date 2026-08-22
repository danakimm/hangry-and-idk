import { env } from "cloudflare:workers";
import {
  createFirebaseSessionResponse,
  type AuthRuntimeEnv,
} from "@/features/auth/server/session-api.server";

export async function POST(request: Request) {
  return createFirebaseSessionResponse(request, env as AuthRuntimeEnv);
}
