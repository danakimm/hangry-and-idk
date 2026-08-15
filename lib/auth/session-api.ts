import { verifyFirebaseToken } from "./firebase-verify.ts";
import {
  buildLogoutCookie,
  buildSessionCookie,
  getSessionCookieName,
  signSession,
  verifySession,
} from "./session.ts";
import type { TokenVerificationResult } from "./types.ts";

export type AuthRuntimeEnv = {
  APP_ORIGIN?: string;
  AUTH_SESSION_SECRET?: string;
  FIREBASE_PROJECT_ID?: string;
};

type VerifyFirebaseToken = (
  idToken: string,
  projectId: string,
) => Promise<TokenVerificationResult>;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function validateOrigin(
  request: Request,
  runtimeEnv: AuthRuntimeEnv,
): Response | null {
  if (!runtimeEnv.APP_ORIGIN) {
    return json(
      {
        error: {
          code: "SERVER_CONFIG_ERROR",
          message: "애플리케이션 origin이 설정되지 않았습니다.",
        },
      },
      500,
    );
  }

  if (request.headers.get("Origin") !== runtimeEnv.APP_ORIGIN) {
    return json(
      {
        error: {
          code: "INVALID_ORIGIN",
          message: "요청이 허용되지 않습니다.",
        },
      },
      403,
    );
  }

  return null;
}

export async function createFirebaseSessionResponse(
  request: Request,
  runtimeEnv: AuthRuntimeEnv,
  verifyToken: VerifyFirebaseToken = verifyFirebaseToken,
): Promise<Response> {
  const originError = validateOrigin(request, runtimeEnv);
  if (originError) return originError;
  const appOrigin = runtimeEnv.APP_ORIGIN!;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(
      {
        error: {
          code: "MISSING_TOKEN",
          message: "ID 토큰이 필요합니다.",
        },
      },
      401,
    );
  }

  const idToken = authHeader.slice(7);
  if (!idToken) {
    return json(
      {
        error: {
          code: "MISSING_TOKEN",
          message: "ID 토큰이 비어 있습니다.",
        },
      },
      401,
    );
  }

  if (!runtimeEnv.FIREBASE_PROJECT_ID || !runtimeEnv.AUTH_SESSION_SECRET) {
    return json(
      {
        error: {
          code: "SERVER_CONFIG_ERROR",
          message: "인증 서버 설정이 완료되지 않았습니다.",
        },
      },
      500,
    );
  }

  const result = await verifyToken(idToken, runtimeEnv.FIREBASE_PROJECT_ID);
  if (!result.ok) {
    return json(
      {
        error: {
          code: "INVALID_TOKEN",
          message: "ID 토큰 검증에 실패했습니다.",
        },
      },
      401,
    );
  }

  const sessionToken = await signSession(
    {
      provider: "firebase",
      subject: result.uid,
      email: result.email,
      name: result.name,
    },
    runtimeEnv.AUTH_SESSION_SECRET,
  );
  const secure = appOrigin.startsWith("https://");

  return json(
    { ok: true },
    200,
    { "Set-Cookie": buildSessionCookie(sessionToken, secure) },
  );
}

export async function getSessionResponse(
  request: Request,
  runtimeEnv: AuthRuntimeEnv,
): Promise<Response> {
  if (!runtimeEnv.AUTH_SESSION_SECRET) {
    return json(
      {
        error: {
          code: "SERVER_CONFIG_ERROR",
          message: "인증 서버 설정이 완료되지 않았습니다.",
        },
      },
      500,
      { Vary: "Cookie" },
    );
  }

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookieName = getSessionCookieName();
  const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) {
    return json({ user: null }, 200, { Vary: "Cookie" });
  }

  const session = await verifySession(match[1], runtimeEnv.AUTH_SESSION_SECRET);
  if (!session) {
    return json({ user: null }, 200, { Vary: "Cookie" });
  }

  return json(
    {
      user: {
        uid: session.subject,
        email: session.email ?? null,
        name: session.name ?? null,
      },
    },
    200,
    { Vary: "Cookie" },
  );
}

export function createLogoutResponse(
  request: Request,
  runtimeEnv: AuthRuntimeEnv,
): Response {
  const originError = validateOrigin(request, runtimeEnv);
  if (originError) return originError;

  const secure = runtimeEnv.APP_ORIGIN!.startsWith("https://");
  return json(
    { ok: true },
    200,
    { "Set-Cookie": buildLogoutCookie(secure) },
  );
}
