import { env } from "cloudflare:workers";

import type {
  Restaurant,
  RestaurantSearchResponse,
} from "../../../lib/restaurants";

const KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const DEFAULT_RADIUS_METERS = 5_000;
const RESULT_SIZE = 10;
const TIMEOUT_MS = 5_000;

type ErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "KAKAO_API_KEY_MISSING"
  | "KAKAO_API_TIMEOUT"
  | "KAKAO_API_ERROR";

type RateLimiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

function apiError(status: number, code: ErrorCode, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

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

const CACHE_TTL_SECONDS = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);

  // IP당 60초에 30회 초과 시 차단 (좌표 바꿔가며 때리는 남용까지 소스에서 차단)
  const limiter = (env as { RATE_LIMITER?: RateLimiter }).RATE_LIMITER;
  if (limiter) {
    const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await limiter.limit({ key: clientIp });
    if (!success) {
      return apiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  const menu = url.searchParams.get("menu")?.trim() ?? "";
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  // 같은 menu+lat+lng는 카카오 재호출 없이 엣지 캐시에서 응답 → 반복/남용 요청 흡수
  const cache = caches.default;
  const cacheKey = new Request(url.toString());
  const cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, cached);

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

  const apiKey = (env as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY?.trim();
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
    x: String(lng),
    y: String(lat),
    radius: String(DEFAULT_RADIUS_METERS),
    sort: "distance",
    size: String(RESULT_SIZE),
  });

  let payload: KakaoPayload;
  try {
    const response = await fetch(`${KAKAO_SEARCH_URL}?${params}`, {
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

  const response = Response.json(body, {
    headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
  });
  await cache.put(cacheKey, response.clone());
  return response;
}
