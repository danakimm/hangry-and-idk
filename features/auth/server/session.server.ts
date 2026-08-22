import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { SessionPayload } from "./types.server.ts";

const SESSION_COOKIE_NAME = "omuo_session";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function isSessionPayload(
  payload: JWTPayload,
): payload is JWTPayload & SessionPayload {
  return (
    typeof payload.provider === "string" &&
    typeof payload.subject === "string" &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number"
  );
}

export async function signSession(
  data: Omit<SessionPayload, "issuedAt" | "expiresAt">,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...data,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS,
  };

  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), {
      algorithms: ["HS256"],
    });

    if (!isSessionPayload(payload)) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.expiresAt < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildLogoutCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export { SESSION_MAX_AGE_SECONDS };
