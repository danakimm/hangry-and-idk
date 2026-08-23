import vinext from "vinext";
import { defineConfig } from "vite";
import d1Config from "./wrangler.d1.json" with { type: "json" };

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // dev: placeholder D1 ID 허용 (로컬 Miniflare가 자체 DB 생성)
  // build: placeholder D1 ID 제외 (잘못된 database_id로 배포 방지)
  const resolvedD1Databases =
    command === "build"
      ? d1Config.d1_databases.filter(
          (db) => db.database_id !== PLACEHOLDER_D1_ID,
        )
      : d1Config.d1_databases;

  const workerConfig = {
    name: "hangry-and-idk",
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    // 배포는 원격 설정을 이 config로 덮어씀 → 커스텀 도메인/워커dev차단/vars를
    // 여기 두어야 대시보드에서 안 날아감 (source of truth = 코드)
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: "hangry-and-idk.site", custom_domain: true }],
    vars: {
      APP_ORIGIN: "https://hangry-and-idk.site",
      FIREBASE_PROJECT_ID: "hangry-and-idk",
    },
    ...(resolvedD1Databases.length > 0
      ? { d1_databases: resolvedD1Databases }
      : {}),
    ratelimits: [
      {
        name: "RATE_LIMITER",
        namespace_id: "1001",
        simple: { limit: 30, period: 60 },
      },
    ],
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: workerConfig,
      }),
    ],
  };
});
