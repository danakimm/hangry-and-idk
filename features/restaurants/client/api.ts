"use client";

import type {
  Restaurant,
  RestaurantSearchResponse,
} from "../shared/contract.ts";

export type RestaurantSearchFailureStatus =
  | "missing-key"
  | "unauthorized"
  | "rate-limited"
  | "error";

export type ParsedRestaurantSearchResponse =
  | { ok: true; data: RestaurantSearchResponse }
  | {
      ok: false;
      status: RestaurantSearchFailureStatus;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRestaurantSearchResponse(
  value: unknown,
): value is RestaurantSearchResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.restaurants) &&
    isRecord(value.meta) &&
    typeof value.meta.totalCount === "number" &&
    typeof value.meta.isEnd === "boolean"
  );
}

function getRestaurantSearchError(
  value: unknown,
): { code: string; message: string } | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  if (
    typeof value.error.code !== "string" ||
    typeof value.error.message !== "string"
  ) {
    return null;
  }
  return value.error as { code: string; message: string };
}

export async function parseRestaurantSearchResponse(
  response: Response,
): Promise<ParsedRestaurantSearchResponse> {
  let payload: unknown = null;
  try {
    const body = await response.text();
    if (body) payload = JSON.parse(body);
  } catch {
    // Cloudflare WAF may return HTML or another non-JSON response.
  }

  if (response.ok && isRestaurantSearchResponse(payload)) {
    return { ok: true, data: payload };
  }

  const error = getRestaurantSearchError(payload);
  if (response.status === 401 || error?.code === "UNAUTHORIZED") {
    return {
      ok: false,
      status: "unauthorized",
      message: error?.message ?? "식당 검색을 이용하려면 로그인해주세요.",
    };
  }

  if (response.status === 429 || error?.code === "RATE_LIMITED") {
    const retryAfter = response.headers.get("Retry-After");
    return {
      ok: false,
      status: "rate-limited",
      message:
        error?.message ??
        (retryAfter && /^\d+$/.test(retryAfter)
          ? `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.`
          : "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."),
    };
  }

  if (error?.code === "KAKAO_API_KEY_MISSING") {
    return {
      ok: false,
      status: "missing-key",
      message: error.message,
    };
  }

  return {
    ok: false,
    status: "error",
    message: error?.message ?? "식당 검색에 실패했습니다.",
  };
}

export type { Restaurant };
