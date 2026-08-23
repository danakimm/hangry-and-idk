import type { AuthRuntimeEnv } from "./session-api.server.ts";
import { readSession } from "./session-api.server.ts";
import type { SessionPayload } from "./types.server.ts";
import type { UserService } from "../../users/server/service.server.ts";

export type CurrentUserResult =
  | { ok: true; session: SessionPayload; internalUserId: string }
  | { ok: false; error: string };

export function createCurrentUserResolver(
  userService: UserService,
) {
  return async function resolveCurrentUser(
    request: Request,
    runtimeEnv: AuthRuntimeEnv,
  ): Promise<CurrentUserResult> {
    if (!runtimeEnv.AUTH_SESSION_SECRET) {
      return { ok: false, error: "인증 서버 설정이 완료되지 않았습니다." };
    }

    const session = await readSession(request, runtimeEnv);
    if (!session) {
      return { ok: false, error: "로그인이 필요합니다." };
    }

    const result = await userService.ensureByFirebaseUid(session.subject);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return { ok: true, session, internalUserId: result.user.id };
  };
}
