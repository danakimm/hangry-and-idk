import {
  decodeProtectedHeader,
  importSPKI,
  jwtVerify,
  type JWTPayload,
} from "jose";
import type { TokenVerificationResult } from "../auth/types";

const FIREBASE_PUBLIC_KEYS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const ALGORITHM = "RS256";
const CLOCK_SKEW_TOLERANCE_SECONDS = 300;
const MAX_AUTH_AGE_SECONDS = 5 * 60;

type CachedKeys = {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
};

let cache: CachedKeys | null = null;

async function fetchPublicKeys(): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.keys;
  }

  const response = await fetch(FIREBASE_PUBLIC_KEYS_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Firebase public keys: ${response.status}`);
  }

  const cacheControl = response.headers.get("Cache-Control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch
    ? Number(maxAgeMatch[1]) * 1000
    : 60 * 60 * 1000;

  const json = (await response.json()) as Record<string, string>;
  const keys = new Map<string, CryptoKey>();

  for (const [kid, pem] of Object.entries(json)) {
    const key = await importSPKI(pem, ALGORITHM);
    keys.set(kid, key);
  }

  cache = { keys, expiresAt: now + maxAgeMs };
  return keys;
}

function isFirebasePayload(
  payload: JWTPayload,
): payload is JWTPayload & {
  sub: string;
  iat: number;
  auth_time: number;
  firebase: { sign_in_provider: string };
} {
  return (
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    payload.sub.length <= 128 &&
    typeof payload.iat === "number" &&
    typeof payload.auth_time === "number" &&
    typeof payload.firebase === "object" &&
    payload.firebase !== null &&
    "sign_in_provider" in payload.firebase &&
    typeof payload.firebase.sign_in_provider === "string"
  );
}

export async function verifyTokenWithKeys(
  idToken: string,
  projectId: string,
  keys: Map<string, CryptoKey>,
): Promise<TokenVerificationResult> {
  try {
    const header = decodeProtectedHeader(idToken);

    if (header.alg !== ALGORITHM) {
      return { ok: false, error: `Unsupported algorithm: ${header.alg}` };
    }

    const kid = header.kid as string;
    const publicKey = keys.get(kid);
    if (!publicKey) {
      return { ok: false, error: `Unknown kid: ${kid}` };
    }

    const issuer = `https://securetoken.google.com/${projectId}`;
    const { payload } = await jwtVerify(idToken, publicKey, {
      algorithms: [ALGORITHM],
      issuer,
      audience: projectId,
    });

    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.iat === "number" &&
      payload.iat > now + CLOCK_SKEW_TOLERANCE_SECONDS
    ) {
      return { ok: false, error: "Token issued in the future" };
    }

    if (
      typeof payload.auth_time === "number" &&
      payload.auth_time > now + CLOCK_SKEW_TOLERANCE_SECONDS
    ) {
      return { ok: false, error: "auth_time is in the future" };
    }

    if (!isFirebasePayload(payload)) {
      return { ok: false, error: "Missing required Firebase claims" };
    }

    if (payload.auth_time < now - MAX_AUTH_AGE_SECONDS) {
      return { ok: false, error: "Authentication is too old" };
    }

    if (payload.firebase.sign_in_provider !== "google.com") {
      return {
        ok: false,
        error: `Unsupported provider: ${payload.firebase.sign_in_provider}`,
      };
    }

    return {
      ok: true,
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown verification error";
    return { ok: false, error: message };
  }
}

export async function verifyFirebaseToken(
  idToken: string,
  projectId: string,
): Promise<TokenVerificationResult> {
  const keys = await fetchPublicKeys();
  return verifyTokenWithKeys(idToken, projectId, keys);
}

export function resetKeyCache(): void {
  cache = null;
}
