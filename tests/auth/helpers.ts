import { exportSPKI, generateKeyPair, SignJWT } from "jose";

const PROJECT_ID = "test-project-id";

type TestKeys = {
  publicKeyPem: string;
  privateKey: CryptoKey;
  kid: string;
};

let cachedTestKeys: TestKeys | null = null;

export async function generateTestKeys(): Promise<TestKeys> {
  if (cachedTestKeys) return cachedTestKeys;

  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
  });
  const publicKeyPem = await exportSPKI(publicKey);
  cachedTestKeys = { publicKeyPem, privateKey, kid: "test-kid-001" };
  return cachedTestKeys;
}

export async function createMockFirebaseToken(
  overrides: {
    sub?: string;
    aud?: string;
    iss?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    name?: string;
    firebase?: { sign_in_provider: string };
    alg?: string;
    kid?: string;
  } = {},
): Promise<string> {
  const keys = await generateTestKeys();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: overrides.alg ?? "RS256",
    kid: overrides.kid ?? keys.kid,
  };

  const payload = {
    sub: overrides.sub ?? "firebase-uid-123",
    aud: overrides.aud ?? PROJECT_ID,
    iss: overrides.iss ?? `https://securetoken.google.com/${PROJECT_ID}`,
    exp: overrides.exp ?? now + 3600,
    iat: overrides.iat ?? now,
    auth_time: overrides.auth_time ?? now,
    email: overrides.email,
    name: overrides.name,
    firebase:
      overrides.firebase ?? { sign_in_provider: "google.com" },
  };

  const jwt = new SignJWT(payload)
    .setProtectedHeader(header)
    .sign(keys.privateKey);

  return jwt;
}

export async function getTestKeysMap(): Promise<Map<string, CryptoKey>> {
  const keys = await generateTestKeys();
  const { importSPKI } = await import("jose");
  const cryptoKey = await importSPKI(keys.publicKeyPem, "RS256");
  const map = new Map<string, CryptoKey>();
  map.set(keys.kid, cryptoKey);
  return map;
}

export { PROJECT_ID };
