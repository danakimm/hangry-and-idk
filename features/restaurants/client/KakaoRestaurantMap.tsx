"use client";

import { useEffect, useRef, useState } from "react";
import type { Restaurant } from "../shared/contract.ts";
import type { Coordinates } from "./types.ts";

type KakaoLatLng = object;

type KakaoMap = {
  setBounds(bounds: KakaoLatLngBounds): void;
};

type KakaoLatLngBounds = {
  extend(position: KakaoLatLng): void;
};

type KakaoCustomOverlay = {
  setMap(map: KakaoMap | null): void;
};

type KakaoMaps = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMap;
  CustomOverlay: new (options: {
    content: HTMLElement;
    position: KakaoLatLng;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
  }) => KakaoCustomOverlay;
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let kakaoMapsPromise: Promise<KakaoMaps> | null = null;

function loadKakaoMaps(appKey: string) {
  if (window.kakao?.maps) {
    return new Promise<KakaoMaps>((resolve) => {
      window.kakao?.maps.load(() => resolve(window.kakao!.maps));
    });
  }

  if (!kakaoMapsPromise) {
    kakaoMapsPromise = new Promise<KakaoMaps>((resolve, reject) => {
      const script = document.createElement("script");
      const params = new URLSearchParams({ appkey: appKey, autoload: "false" });
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?${params}`;
      script.async = true;
      script.dataset.kakaoMapSdk = "true";
      script.onload = () => {
        if (!window.kakao?.maps) {
          reject(new Error("Kakao Maps SDK was not initialized."));
          return;
        }
        window.kakao.maps.load(() => resolve(window.kakao!.maps));
      };
      script.onerror = () => reject(new Error("Kakao Maps SDK failed to load."));
      document.head.appendChild(script);
    });
  }

  return kakaoMapsPromise;
}

function createRestaurantMarker(restaurant: Restaurant, index: number) {
  const marker = document.createElement("a");
  marker.className = "restaurant-map-marker";
  marker.href = restaurant.placeUrl;
  marker.target = "_blank";
  marker.rel = "noreferrer";
  marker.textContent = String(index + 1).padStart(2, "0");
  marker.title = `${restaurant.name} 상세 보기`;
  marker.setAttribute("aria-label", `${index + 1}번 ${restaurant.name} 상세 보기`);
  return marker;
}

type KakaoRestaurantMapProps = {
  coordinates: Coordinates;
  restaurants: Restaurant[];
  selectedColor: string;
  selectedEmoji: string;
  selectedName: string;
};

export default function KakaoRestaurantMap({
  coordinates,
  restaurants,
  selectedColor,
  selectedEmoji,
  selectedName,
}: KakaoRestaurantMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY?.trim();
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "missing-key" | "error">(
    appKey ? "loading" : "missing-key",
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!appKey) return;

    let cancelled = false;
    let overlays: KakaoCustomOverlay[] = [];

    void loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled) return;

        const currentPosition = new maps.LatLng(
          coordinates.latitude,
          coordinates.longitude,
        );
        const map = new maps.Map(container, { center: currentPosition, level: 4 });
        const bounds = new maps.LatLngBounds();
        bounds.extend(currentPosition);

        const currentMarker = document.createElement("span");
        currentMarker.className = "current-location-marker";
        currentMarker.textContent = "내 위치";
        overlays.push(
          new maps.CustomOverlay({
            content: currentMarker,
            position: currentPosition,
            yAnchor: 1,
            zIndex: 5,
          }),
        );

        restaurants.forEach((restaurant, index) => {
          const position = new maps.LatLng(restaurant.latitude, restaurant.longitude);
          bounds.extend(position);
          overlays.push(
            new maps.CustomOverlay({
              content: createRestaurantMarker(restaurant, index),
              position,
              yAnchor: 1,
              zIndex: 4,
            }),
          );
        });

        overlays.forEach((overlay) => overlay.setMap(map));
        if (restaurants.length > 0) map.setBounds(bounds);
        setMapStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setMapStatus("error");
      });

    return () => {
      cancelled = true;
      overlays.forEach((overlay) => overlay.setMap(null));
      overlays = [];
      container.replaceChildren();
    };
  }, [appKey, coordinates.latitude, coordinates.longitude, restaurants]);

  return (
    <div className="kakao-map-shell">
      <div className="kakao-map-canvas" ref={containerRef} aria-label="주변 식당 지도" />
      {mapStatus !== "ready" && (
        <div className="kakao-map-state">
          {mapStatus === "loading" && <p>지도를 불러오고 있어요...</p>}
          {mapStatus === "missing-key" && (
            <>
              <strong>카카오맵 JavaScript 키가 필요해요</strong>
              <code>NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY</code>
            </>
          )}
          {mapStatus === "error" && <p>카카오맵을 불러오지 못했습니다.</p>}
        </div>
      )}
      <div className="map-pick-badge" style={{ backgroundColor: selectedColor }}>
        <span aria-hidden="true">{selectedEmoji}</span>
        <div>
          <small>TODAY&apos;S PICK</small>
          <strong>{selectedName}</strong>
        </div>
      </div>
    </div>
  );
}
