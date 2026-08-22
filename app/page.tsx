"use client";

import { useCallback, useRef, useState } from "react";
import { parseRestaurantSearchResponse } from "@/features/restaurants/client/api";
import type { Restaurant } from "@/features/restaurants/shared/contract";
import type { Coordinates } from "@/features/restaurants/client/types";
import type { MenuItem } from "@/features/roulette/shared/contract";
import { LOCATION_TIMEOUT_MS } from "@/features/roulette/shared/constants";
import MenuEditor from "@/features/roulette/client/MenuEditor";
import RouletteWheel from "@/features/roulette/client/RouletteWheel";
import type { RouletteWheelHandle } from "@/features/roulette/client/RouletteWheel";
import RouletteResult from "@/features/roulette/client/RouletteResult";
import UserMenu from "@/features/auth/client/UserMenu";
import { useMenuState } from "@/features/roulette/client/useMenuState";

export default function Home() {
  const { menus, addMenu, removeMenu, resetMenus, resetKey } = useMenuState();
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantStatus, setRestaurantStatus] = useState<
    "idle" | "loading" | "ready" | "missing-key" | "unauthorized" | "rate-limited" | "error"
  >("idle");
  const [restaurantMessage, setRestaurantMessage] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<RouletteWheelHandle>(null);
  const restaurantRequestIdRef = useRef(0);

  const clearRestaurantSearch = useCallback(() => {
    restaurantRequestIdRef.current += 1;
    setRestaurants([]);
    setRestaurantStatus("idle");
    setRestaurantMessage("");
  }, []);

  const searchRestaurants = useCallback(
    async (
      menuName: string,
      nextCoordinates: Coordinates,
      requestId: number,
    ) => {
      setRestaurants([]);
      setRestaurantMessage("");
      setRestaurantStatus("loading");

      const params = new URLSearchParams({
        menu: menuName,
        lat: String(nextCoordinates.latitude),
        lng: String(nextCoordinates.longitude),
      });

      try {
        const response = await fetch(`/api/restaurants?${params}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const result = await parseRestaurantSearchResponse(response);

        if (restaurantRequestIdRef.current !== requestId) return;

        if (!result.ok) {
          setRestaurantStatus(result.status);
          setRestaurantMessage(result.message);
          return;
        }

        setRestaurants(result.data.restaurants);
        setRestaurantStatus("ready");
      } catch {
        if (restaurantRequestIdRef.current !== requestId) return;
        setRestaurantStatus("error");
        setRestaurantMessage("식당 검색 서버에 연결하지 못했습니다.");
      }
    },
    [],
  );

  const handleSpinStart = useCallback(() => {
    setSelected(null);
    setCoordinates(null);
    setLocationStatus("idle");
    clearRestaurantSearch();
    setIsSpinning(true);
  }, [clearRestaurantSearch]);

  const handleSpinComplete = useCallback((item: MenuItem) => {
    setSelected(item);
    setIsSpinning(false);
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }, []);

  const handleAddMenu = useCallback(
    (name: string, emoji: string) => {
      addMenu(name, emoji);
      setSelected(null);
      clearRestaurantSearch();
    },
    [addMenu, clearRestaurantSearch],
  );

  const handleRemoveMenu = useCallback(
    (id: string) => {
      if (menus.length <= 2 || isSpinning) return;
      removeMenu(id);
      setSelected(null);
      wheelRef.current?.resetRotation();
      clearRestaurantSearch();
    },
    [menus.length, isSpinning, removeMenu, clearRestaurantSearch],
  );

  const handleResetMenus = useCallback(() => {
    if (isSpinning) return;
    resetMenus();
    setSelected(null);
    setCoordinates(null);
    setLocationStatus("idle");
    wheelRef.current?.resetRotation();
    clearRestaurantSearch();
  }, [isSpinning, resetMenus, clearRestaurantSearch]);

  const requestLocation = useCallback(() => {
    if (!selected) return;

    if (coordinates) {
      const requestId = ++restaurantRequestIdRef.current;
      void searchRestaurants(selected.name, coordinates, requestId);
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }

    const requestId = ++restaurantRequestIdRef.current;
    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (restaurantRequestIdRef.current !== requestId) return;
        const nextCoordinates = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        setCoordinates(nextCoordinates);
        setLocationStatus("ready");
        void searchRestaurants(selected.name, nextCoordinates, requestId);
      },
      () => {
        if (restaurantRequestIdRef.current !== requestId) return;
        setLocationStatus("denied");
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 300000 },
    );
  }, [selected, coordinates, searchRestaurants]);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="오늘 뭐 먹지 홈">
          <span className="brand-mark" aria-hidden="true">?</span>
          <span>오늘 뭐 먹지?</span>
        </a>
        <UserMenu />
        <div className="header-note">
          <span className="status-dot" aria-hidden="true" />
          결정 장애 구조대, 영업 중
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">TODAY&apos;S MENU PICKER</p>
          <h1>
            고민은 짧게,
            <br />
            <span>한 끼는 맛있게.</span>
          </h1>
        </div>
        <p className="hero-copy">
          먹고 싶은 메뉴를 담고 룰렛을 돌려보세요.
          <br />
          오늘의 메뉴부터 근처 맛집까지 바로 찾아드릴게요.
        </p>
      </section>

      <section className="game-board" aria-label="메뉴 룰렛">
        <RouletteWheel
          ref={wheelRef}
          menus={menus}
          onSpinStart={handleSpinStart}
          onSpinComplete={handleSpinComplete}
        />

        <MenuEditor
          menus={menus}
          isSpinning={isSpinning}
          resetKey={resetKey}
          onAdd={handleAddMenu}
          onRemove={handleRemoveMenu}
          onReset={handleResetMenus}
        />
      </section>

      <RouletteResult
        ref={resultRef}
        selected={selected}
        coordinates={coordinates}
        restaurants={restaurants}
        locationStatus={locationStatus}
        restaurantStatus={restaurantStatus}
        restaurantMessage={restaurantMessage}
        onRequestLocation={requestLocation}
      />

      <footer>
        <p>오늘 뭐 먹지?</p>
        <span>메뉴 고민은 룰렛에게, 맛있는 식사는 당신에게.</span>
        <a href="#top">맨 위로 ↑</a>
      </footer>
    </main>
  );
}
