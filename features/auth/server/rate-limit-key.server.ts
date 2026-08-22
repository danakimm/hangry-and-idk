const RATE_LIMIT_PREFIX = "restaurants:user:";

export async function firebaseUidToRateLimitKey(uid: string): Promise<string> {
  const data = new TextEncoder().encode(`firebase:${uid}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${RATE_LIMIT_PREFIX}${hashHex}`;
}
