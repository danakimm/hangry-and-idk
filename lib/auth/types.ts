export type SessionPayload = {
  provider: "firebase";
  subject: string;
  email?: string;
  name?: string;
  issuedAt: number;
  expiresAt: number;
};

export type TokenVerificationResult =
  | { ok: true; uid: string; email?: string; name?: string }
  | { ok: false; error: string };
