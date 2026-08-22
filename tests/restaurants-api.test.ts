import assert from "node:assert/strict";
import test from "node:test";
import { firebaseUidToRateLimitKey } from "../features/auth/server/rate-limit-key.server.ts";
import { signSession } from "../features/auth/server/session.server.ts";
import {
  handleRestaurantRequest,
  type RestaurantApiEnv,
  type RestaurantCache,
} from "../features/restaurants/server/search.server.ts";

const APP_ORIGIN = "https://hangry-and-idk.site";
const SESSION_SECRET = "test-session-secret-that-is-long-enough-for-hmac";

const kakaoPayload = {
  meta: { total_count: 1, is_end: true },
  documents: [
    {
      id: "place-1",
      place_name: "테스트 식당",
      address_name: "서울 마포구",
      road_address_name: "서울 마포구 테스트로 1",
      category_name: "음식점 > 한식",
      phone: "02-000-0000",
      distance: "123",
      x: "126.9495",
      y: "37.5465",
      place_url: "https://place.map.kakao.com/1",
    },
  ],
};

function createMemoryCache(): {
  cache: RestaurantCache;
  entries: Map<string, Response>;
} {
  const entries = new Map<string, Response>();
  return {
    entries,
    cache: {
      async match(request) {
        return entries.get(request.url)?.clone();
      },
      async put(request, response) {
        entries.set(request.url, response.clone());
      },
    },
  };
}

function createRuntimeEnv(
  rateLimitKeys: string[],
  success = true,
): RestaurantApiEnv {
  return {
    APP_ORIGIN,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    FIREBASE_PROJECT_ID: "test-project-id",
    KAKAO_REST_API_KEY: "test-kakao-key",
    RATE_LIMITER: {
      async limit({ key }) {
        rateLimitKeys.push(key);
        return { success };
      },
    },
  };
}

async function createSessionCookie(uid = "firebase-uid-123"): Promise<string> {
  const token = await signSession(
    { provider: "firebase", subject: uid },
    SESSION_SECRET,
  );
  return `omuo_session=${token}`;
}

function restaurantRequest(
  cookie?: string,
  query = "menu=버거&lat=37.5465495&lng=126.9495374",
): Request {
  return new Request(`${APP_ORIGIN}/api/restaurants?${query}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function kakaoSuccessFetch(fetchCalls: string[]) {
  return async (input: string | URL | Request): Promise<Response> => {
    fetchCalls.push(String(input));
    return Response.json(kakaoPayload);
  };
}

test("validates input before session and rate limit checks", async () => {
  const rateLimitKeys: string[] = [];
  const fetchCalls: string[] = [];
  const { cache } = createMemoryCache();
  const response = await handleRestaurantRequest(
    restaurantRequest(undefined, "menu=&lat=37.5&lng=126.9"),
    createRuntimeEnv(rateLimitKeys),
    { cache, fetch: kakaoSuccessFetch(fetchCalls) },
  );

  assert.equal(response.status, 400);
  assert.deepStrictEqual(rateLimitKeys, []);
  assert.deepStrictEqual(fetchCalls, []);
});

test("rejects unauthenticated requests before rate limit and Kakao", async () => {
  const rateLimitKeys: string[] = [];
  const fetchCalls: string[] = [];
  const { cache } = createMemoryCache();
  const response = await handleRestaurantRequest(
    restaurantRequest(),
    createRuntimeEnv(rateLimitKeys),
    { cache, fetch: kakaoSuccessFetch(fetchCalls) },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepStrictEqual(await response.json(), {
    error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
  });
  assert.deepStrictEqual(rateLimitKeys, []);
  assert.deepStrictEqual(fetchCalls, []);
});

test("reports a missing session secret as a server error", async () => {
  const rateLimitKeys: string[] = [];
  const { cache } = createMemoryCache();
  const runtimeEnv = createRuntimeEnv(rateLimitKeys);
  delete runtimeEnv.AUTH_SESSION_SECRET;

  const response = await handleRestaurantRequest(
    restaurantRequest(),
    runtimeEnv,
    { cache, fetch: kakaoSuccessFetch([]) },
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
});

test("fails closed with the correct error when rate limiter is missing", async () => {
  const rateLimitKeys: string[] = [];
  const { cache } = createMemoryCache();
  const runtimeEnv = createRuntimeEnv(rateLimitKeys);
  delete runtimeEnv.RATE_LIMITER;

  const response = await handleRestaurantRequest(
    restaurantRequest(await createSessionCookie()),
    runtimeEnv,
    { cache, fetch: kakaoSuccessFetch([]) },
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(body.error.message, /카카오/i);
});

test("uses the verified Firebase UID and returns Retry-After on limit", async () => {
  const rateLimitKeys: string[] = [];
  const fetchCalls: string[] = [];
  const { cache } = createMemoryCache();
  const response = await handleRestaurantRequest(
    restaurantRequest(await createSessionCookie("rate-limited-user")),
    createRuntimeEnv(rateLimitKeys, false),
    { cache, fetch: kakaoSuccessFetch(fetchCalls) },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepStrictEqual(rateLimitKeys, [
    await firebaseUidToRateLimitKey("rate-limited-user"),
  ]);
  assert.deepStrictEqual(fetchCalls, []);
});

test("counts cache hits while reusing normalized Kakao results", async () => {
  const rateLimitKeys: string[] = [];
  const fetchCalls: string[] = [];
  const { cache, entries } = createMemoryCache();
  const runtimeEnv = createRuntimeEnv(rateLimitKeys);
  const cookie = await createSessionCookie();
  const dependencies = { cache, fetch: kakaoSuccessFetch(fetchCalls) };

  const firstResponse = await handleRestaurantRequest(
    restaurantRequest(cookie, "menu=버거&lat=37.546541&lng=126.949541"),
    runtimeEnv,
    dependencies,
  );
  const secondResponse = await handleRestaurantRequest(
    restaurantRequest(cookie, "menu=버거&lat=37.546542&lng=126.949542"),
    runtimeEnv,
    dependencies,
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(firstResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal(secondResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal(fetchCalls.length, 1);
  assert.equal(rateLimitKeys.length, 2);
  assert.equal(entries.size, 1);
  assert.equal(
    [...entries.values()][0].headers.get("Cache-Control"),
    "public, max-age=300",
  );
  assert.deepStrictEqual(await secondResponse.json(), {
    restaurants: [
      {
        id: "place-1",
        name: "테스트 식당",
        address: "서울 마포구",
        roadAddress: "서울 마포구 테스트로 1",
        category: "음식점 > 한식",
        phone: "02-000-0000",
        distanceMeters: 123,
        longitude: 126.9495,
        latitude: 37.5465,
        placeUrl: "https://place.map.kakao.com/1",
      },
    ],
    meta: { totalCount: 1, isEnd: true },
  });
});

test("returns a timeout error without caching a Kakao failure", async () => {
  const rateLimitKeys: string[] = [];
  const { cache, entries } = createMemoryCache();
  const response = await handleRestaurantRequest(
    restaurantRequest(await createSessionCookie()),
    createRuntimeEnv(rateLimitKeys),
    {
      cache,
      async fetch() {
        throw new DOMException("timed out", "TimeoutError");
      },
    },
  );

  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, "KAKAO_API_TIMEOUT");
  assert.equal(entries.size, 0);
});

test("returns a controlled error for a failed Kakao response", async () => {
  const rateLimitKeys: string[] = [];
  const { cache, entries } = createMemoryCache();
  const response = await handleRestaurantRequest(
    restaurantRequest(await createSessionCookie()),
    createRuntimeEnv(rateLimitKeys),
    {
      cache,
      async fetch() {
        return new Response("upstream failure", { status: 503 });
      },
    },
  );

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "KAKAO_API_ERROR");
  assert.equal(entries.size, 0);
});

test("returns a controlled error when the rate limiter throws", async () => {
  const { cache } = createMemoryCache();
  const runtimeEnv = createRuntimeEnv([]);
  runtimeEnv.RATE_LIMITER = {
    async limit() {
      throw new Error("limiter unavailable");
    },
  };
  const response = await handleRestaurantRequest(
    restaurantRequest(await createSessionCookie()),
    runtimeEnv,
    { cache, fetch: kakaoSuccessFetch([]) },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
});
