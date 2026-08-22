import { env } from "cloudflare:workers";

import {
  handleRestaurantRequest,
  type RestaurantApiEnv,
  type RestaurantCache,
} from "@/features/restaurants/server/search.server";

export async function GET(request: Request) {
  const cache = (caches as CacheStorage & { default: Cache })
    .default as RestaurantCache;

  return handleRestaurantRequest(request, env as RestaurantApiEnv, {
    cache,
    fetch,
  });
}
