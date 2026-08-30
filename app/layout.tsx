import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { AuthProvider } from "@/features/auth/client/AuthProvider";
import type { AppRuntimeEnv } from "@/server/runtime-env.server";
import { isFeatureEnabled } from "@/server/runtime-env.server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    title: "오늘 뭐 먹지? | 메뉴 룰렛",
    description: "메뉴 룰렛을 돌리고 내 주변 맛집까지 바로 찾아보세요.",
    metadataBase,
    openGraph: {
      title: "오늘 뭐 먹지?",
      description: "돌리고, 근처 맛집까지.",
      images: [{ url: socialImage, width: 1731, height: 909, alt: "오늘 뭐 먹지 메뉴 룰렛" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "오늘 뭐 먹지?",
      description: "돌리고, 근처 맛집까지.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtimeEnv = env as AppRuntimeEnv;
  const menuSetsEnabled = isFeatureEnabled(runtimeEnv.FEATURE_MENU_SETS);
  const decisionHistoryEnabled = isFeatureEnabled(
    runtimeEnv.FEATURE_DECISION_HISTORY,
  );

  return (
    <html lang="ko">
      <head>
        <link rel="icon" href="/icon.png" type="image/png" sizes="128x128" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AuthProvider
          menuSetsEnabled={menuSetsEnabled}
          decisionHistoryEnabled={decisionHistoryEnabled}
        >
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
