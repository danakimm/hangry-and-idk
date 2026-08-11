import { NextRequest, NextResponse } from "next/server";
import type {
  Restaurant,
  RestaurantSearchError,
  RestaurantSearchResponse,
} from "../../../lib/restaurants";

const KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const DEFAULT_RADIUS_METERS = 5_000;
const RESULT_SIZE = 10;

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

type KakaoSearchResponse = {
  meta: {
    total_count: number;
    is_end: boolean;
  };
  documents: KakaoPlace[];
};

function errorResponse(
  status: number,
  code: RestaurantSearchError["error"]["code"],
  message: string,
) {
  return NextResponse.json<RestaurantSearchError>(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function parseCoordinate(value: string | null, min: number, max: number) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export async function GET(request: NextRequest) {
  const menu = request.nextUrl.searchParams.get("menu")?.trim();
  const latitude = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const longitude = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);

  if (!menu || menu.length > 50 || latitude === null || longitude === null) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "menu, lat, lng 값을 올바르게 전달해주세요.",
    );
  }

  const kakaoApiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!kakaoApiKey) {
    return errorResponse(
      503,
      "KAKAO_API_KEY_MISSING",
      "카카오 REST API 키가 아직 설정되지 않았습니다.",
    );
  }

  const kakaoUrl = new URL(KAKAO_SEARCH_URL);
  kakaoUrl.searchParams.set("query", `${menu} 맛집`);
  kakaoUrl.searchParams.set("category_group_code", "FD6");
  kakaoUrl.searchParams.set("x", String(longitude));
  kakaoUrl.searchParams.set("y", String(latitude));
  kakaoUrl.searchParams.set("radius", String(DEFAULT_RADIUS_METERS));
  kakaoUrl.searchParams.set("sort", "distance");
  kakaoUrl.searchParams.set("size", String(RESULT_SIZE));

  try {
    const kakaoResponse = await fetch(kakaoUrl, {
      headers: { Authorization: `KakaoAK ${kakaoApiKey}` },
    });

    if (!kakaoResponse.ok) {
      console.error("Kakao Local API error", kakaoResponse.status);
      return errorResponse(
        502,
        "KAKAO_API_ERROR",
        "카카오에서 식당 정보를 가져오지 못했습니다.",
      );
    }

    const kakaoData = (await kakaoResponse.json()) as KakaoSearchResponse;
    const restaurants: Restaurant[] = kakaoData.documents.map((place) => ({
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

    return NextResponse.json<RestaurantSearchResponse>(
      {
        restaurants,
        meta: {
          totalCount: kakaoData.meta.total_count,
          isEnd: kakaoData.meta.is_end,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Restaurant search failed", error);
    return errorResponse(500, "INTERNAL_ERROR", "식당 검색 중 문제가 발생했습니다.");
  }
}
