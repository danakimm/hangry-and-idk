import { env } from "cloudflare:workers";
import {
  createFirebaseSessionResponse,
  type AuthRuntimeEnv,
} from "@/lib/auth/session-api";

export async function POST(request: Request) {
  return createFirebaseSessionResponse(request, env as AuthRuntimeEnv);
}
