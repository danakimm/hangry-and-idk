import type { AuthRuntimeEnv } from "../features/auth/server/session-api.server.ts";
import type { RestaurantApiEnv, RateLimiter } from "../features/restaurants/server/search.server.ts";
import type { D1Database } from "./db/types.server.ts";

export type AppRuntimeEnv = AuthRuntimeEnv &
  RestaurantApiEnv & {
    DB?: D1Database;
    APP_WRITE_RATE_LIMITER?: RateLimiter;
    ROOM_JOIN_RATE_LIMITER?: RateLimiter;
    FEATURE_MENU_SETS?: string;
    FEATURE_DECISION_HISTORY?: string;
    FEATURE_SHARED_ROULETTE?: string;
  };

export function isFeatureEnabled(
  flag: string | undefined,
): boolean {
  return flag === "true";
}
