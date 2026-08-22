import assert from "node:assert/strict";
import test from "node:test";
import { parseRestaurantSearchResponse } from "../features/restaurants/client/api.ts";

test("parses a successful restaurant response", async () => {
  const response = Response.json({
    restaurants: [],
    meta: { totalCount: 0, isEnd: true },
  });

  assert.deepStrictEqual(await parseRestaurantSearchResponse(response), {
    ok: true,
    data: {
      restaurants: [],
      meta: { totalCount: 0, isEnd: true },
    },
  });
});

test("maps a JSON unauthorized response", async () => {
  const response = Response.json(
    { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } },
    { status: 401 },
  );

  assert.deepStrictEqual(await parseRestaurantSearchResponse(response), {
    ok: false,
    status: "unauthorized",
    message: "로그인이 필요합니다.",
  });
});

test("handles a non-JSON WAF 429 response", async () => {
  const response = new Response("<html>rate limited</html>", {
    status: 429,
    headers: {
      "Content-Type": "text/html",
      "Retry-After": "60",
    },
  });

  assert.deepStrictEqual(await parseRestaurantSearchResponse(response), {
    ok: false,
    status: "rate-limited",
    message: "요청이 너무 많습니다. 60초 후 다시 시도해주세요.",
  });
});

test("handles malformed non-JSON error responses without throwing", async () => {
  const response = new Response("not-json", { status: 502 });

  assert.deepStrictEqual(await parseRestaurantSearchResponse(response), {
    ok: false,
    status: "error",
    message: "식당 검색에 실패했습니다.",
  });
});
