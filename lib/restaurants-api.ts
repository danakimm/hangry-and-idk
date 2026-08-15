import { firebaseUidToRateLimitKey } from "./auth/rate-limit-key.ts";
import {
  readSession,
  type AuthRuntimeEnv,
} from "./auth/session-api.ts";
import type {
  Restaurant,
  RestaurantSearchError,
  RestaurantSearchResponse,
} from "./restaurants.ts";

const KAKAO_SEARCH_URL =
  "https://dapi.kakao.com/v2/local/search/keyword.json";
const DEFAULT_RADIUS_METERS = 5_000;
const RESULT_SIZE = 10;
const TIMEOUT_MS = 5_000;
const COORD_CACHE_SCALE = 10_000;
const CACHE_TTL_SECONDS = 300;
const RATE_LIMIT_RETRY_AFTER = 60;

type ErrorCode = RestaurantSearchError["error"]["code"];

export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RestaurantApiEnv = AuthRuntimeEnv & {
  KAKAO_REST_API_KEY?: string;
  RATE_LIMITER?: RateLimiter;
};

export type RestaurantCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type RestaurantFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type RestaurantApiDependencies = {
  cache: RestaurantCache;
  fetch: RestaurantFetch;
};

type KakaoPlace = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_name: string;
  phone: string;
  distance: string;
  x: string;
  y: string;
  place_url: string;
};

type KakaoPayload = {
  meta: { total_count: number; is_end: boolean };
  documents: KakaoPlace[];
};

function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "no-store", ...extraHeaders },
    },
  );
}

function preventClientCaching(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleRestaurantRequest(
  request: Request,
  runtimeEnv: RestaurantApiEnv,
  dependencies: RestaurantApiDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const menu = url.searchParams.get("menu")?.trim() ?? "";
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  if (
    !menu ||
    menu.length > 50 ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return apiError(
      400,
      "INVALID_REQUEST",
      "menu, lat, lng 값을 올바르게 전달해주세요.",
    );
  }

  if (!runtimeEnv.AUTH_SESSION_SECRET) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      "인증 서버 설정이 완료되지 않았습니다.",
    );
  }

  const session = await readSession(request, runtimeEnv);
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  }

  if (!runtimeEnv.RATE_LIMITER) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      "요청 제한 서버 설정이 완료되지 않았습니다.",
    );
  }

  const rateLimitKey = await firebaseUidToRateLimitKey(session.subject);
  try {
    const { success } = await runtimeEnv.RATE_LIMITER.limit({
      key: rateLimitKey,
    });
    if (!success) {
      return apiError(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) },
      );
    }
  } catch {
    return apiError(
      503,
      "INTERNAL_ERROR",
      "요청 제한 서비스를 사용할 수 없습니다.",
    );
  }

  const nlat = Math.round(lat * COORD_CACHE_SCALE) / COORD_CACHE_SCALE;
  const nlng = Math.round(lng * COORD_CACHE_SCALE) / COORD_CACHE_SCALE;
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?menu=${encodeURIComponent(menu)}&lat=${nlat}&lng=${nlng}`,
  );
  const cached = await dependencies.cache.match(cacheKey);
  if (cached) return preventClientCaching(cached);

  const apiKey = runtimeEnv.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) {
    return apiError(
      503,
      "KAKAO_API_KEY_MISSING",
      "카카오 REST API 키가 아직 설정되지 않았습니다.",
    );
  }

  const params = new URLSearchParams({
    query: `${menu} 맛집`,
    category_group_code: "FD6",
    x: String(nlng),
    y: String(nlat),
    radius: String(DEFAULT_RADIUS_METERS),
    sort: "distance",
    size: String(RESULT_SIZE),
  });

  let payload: KakaoPayload;
  try {
    const response = await dependencies.fetch(`${KAKAO_SEARCH_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return apiError(
        502,
        "KAKAO_API_ERROR",
        "카카오에서 식당 정보를 가져오지 못했습니다.",
      );
    }
    payload = (await response.json()) as KakaoPayload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return apiError(
        504,
        "KAKAO_API_TIMEOUT",
        "카카오 식당 검색 응답이 지연되고 있습니다.",
      );
    }
    return apiError(
      502,
      "KAKAO_API_ERROR",
      "카카오에서 식당 정보를 가져오지 못했습니다.",
    );
  }

  if (!payload?.documents || !payload.meta) {
    return apiError(
      502,
      "KAKAO_API_ERROR",
      "카카오 식당 검색 응답 형식이 올바르지 않습니다.",
    );
  }

  const restaurants: Restaurant[] = payload.documents.map((place) => ({
    id: place.id,
    name: place.place_name,
    address: place.address_name,
    roadAddress: place.road_address_name,
    category: place.category_name,
    phone: place.phone,
    distanceMeters: place.distance ? Number(place.distance) : null,
    longitude: Number(place.x),
    latitude: Number(place.y),
    placeUrl: place.place_url,
  }));

  const body: RestaurantSearchResponse = {
    restaurants,
    meta: {
      totalCount: payload.meta.total_count,
      isEnd: payload.meta.is_end,
    },
  };
  const cacheResponse = Response.json(body, {
    headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
  });
  await dependencies.cache.put(cacheKey, cacheResponse.clone());
  return preventClientCaching(cacheResponse);
}
