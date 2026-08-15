import { env } from "cloudflare:workers";

import {
  handleRestaurantRequest,
  type RestaurantApiEnv,
  type RestaurantCache,
} from "@/lib/restaurants-api";

export async function GET(request: Request) {
  const cache = (caches as CacheStorage & { default: Cache })
    .default as RestaurantCache;

  return handleRestaurantRequest(request, env as RestaurantApiEnv, {
    cache,
    fetch,
  });
}
