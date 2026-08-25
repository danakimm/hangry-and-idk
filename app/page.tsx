"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseRestaurantSearchResponse } from "@/features/restaurants/client/api";
import type { Restaurant } from "@/features/restaurants/shared/contract";
import type { Coordinates } from "@/features/restaurants/client/types";
import type { MenuItem } from "@/features/roulette/shared/contract";
import { LOCATION_TIMEOUT_MS, palette } from "@/features/roulette/shared/constants";
import MenuEditor from "@/features/roulette/client/MenuEditor";
import RouletteWheel from "@/features/roulette/client/RouletteWheel";
import type { RouletteWheelHandle } from "@/features/roulette/client/RouletteWheel";
import RouletteResult from "@/features/roulette/client/RouletteResult";
import UserMenu from "@/features/auth/client/UserMenu";
import { initialMenus, useMenuState } from "@/features/roulette/client/useMenuState";
import { useAuth } from "@/features/auth/client/AuthProvider";
import { useMenuSets } from "@/features/menu-sets/client/hooks";
import MenuSetSelector from "@/features/menu-sets/client/MenuSetSelector";
import MenuSetEditor from "@/features/menu-sets/client/MenuSetEditor";
import MenuSetSaveStatus from "@/features/menu-sets/client/MenuSetSaveStatus";
import type { MenuSetItemRequest } from "@/features/menu-sets/shared/contract";

type FirstLoginPromptState = {
  show: boolean;
  anonymousItems: MenuItem[];
};

type ActiveMenuSource = "anonymous" | "menu-set";

export default function Home() {
  const anonymousMenuState = useMenuState();
  const { status, menuSetsEnabled, onLogoutCleanup } = useAuth();
  const isAuthenticated = status === "authenticated";

  const menuSets = useMenuSets();

  const [activeMenuSource, setActiveMenuSource] = useState<ActiveMenuSource>("anonymous");
  const [rouletteResetKey, setRouletteResetKey] = useState(0);
  const [firstLoginPrompt, setFirstLoginPrompt] = useState<FirstLoginPromptState>({
    show: false,
    anonymousItems: [],
  });
  const [firstLoginName, setFirstLoginName] = useState("");
  const [newMenuSetName, setNewMenuSetName] = useState("");
  const [isNewMenuSetFormOpen, setIsNewMenuSetFormOpen] = useState(false);
  const [conflictMenuSetName, setConflictMenuSetName] = useState("");
  const prevAuthRef = useRef(status);

  const rouletteMenus: MenuItem[] =
    activeMenuSource === "menu-set" && menuSets.currentMenuSet
      ? menuSets.draftItems.map((item, index) => ({
          id: item.id ?? `draft-new-${index}`,
          name: item.name,
          emoji: item.emoji,
          color: item.color,
        }))
      : anonymousMenuState.menus;

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

  useEffect(() => {
    if (
      menuSetsEnabled &&
      prevAuthRef.current !== "authenticated" &&
      status === "authenticated"
    ) {
      setActiveMenuSource("anonymous");
      setFirstLoginPrompt({
        show: true,
        anonymousItems: anonymousMenuState.menus.map((menu) => ({ ...menu })),
      });
    }
    prevAuthRef.current = status;
  }, [status, menuSetsEnabled, anonymousMenuState.menus]);

  useEffect(() => onLogoutCleanup(() => {
    setActiveMenuSource("anonymous");
    setFirstLoginPrompt({ show: false, anonymousItems: [] });
    setFirstLoginName("");
    setIsNewMenuSetFormOpen(false);
    setNewMenuSetName("");
    setConflictMenuSetName("");
  }), [onLogoutCleanup]);

  useEffect(() => {
    if (
      activeMenuSource === "menu-set" &&
      !menuSets.isLoading &&
      !menuSets.currentMenuSet
    ) {
      setActiveMenuSource("anonymous"); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [activeMenuSource, menuSets.currentMenuSet, menuSets.isLoading]);

  useEffect(() => {
    if (menuSets.saveStatus === "conflict" && !conflictMenuSetName) {
      setConflictMenuSetName( // eslint-disable-line react-hooks/set-state-in-effect
        `${menuSets.draftName || "메뉴판"} 복사본`.slice(0, 30),
      );
    }
  }, [menuSets.saveStatus, menuSets.draftName, conflictMenuSetName]);

  const handleFirstLoginSaveAsNew = useCallback(async () => {
    if (!firstLoginName.trim()) return;
    const items: MenuSetItemRequest[] = firstLoginPrompt.anonymousItems.map((m) => ({
      id: null,
      name: m.name,
      emoji: m.emoji,
      color: m.color,
    }));
    const created = await menuSets.createNew(firstLoginName.trim(), items);
    if (!created) return;
    setActiveMenuSource("menu-set");
    setFirstLoginPrompt({ show: false, anonymousItems: [] });
    setFirstLoginName("");
    setRouletteResetKey((key) => key + 1);
  }, [firstLoginName, firstLoginPrompt.anonymousItems, menuSets]);

  const handleFirstLoginLoadDefault = useCallback(() => {
    setFirstLoginPrompt({ show: false, anonymousItems: [] });
    if (menuSets.currentMenuSet) {
      setActiveMenuSource("menu-set");
      setRouletteResetKey((key) => key + 1);
    }
  }, [menuSets]);

  const handleFirstLoginKeepAnonymous = useCallback(() => {
    setActiveMenuSource("anonymous");
    setFirstLoginPrompt({ show: false, anonymousItems: [] });
  }, []);

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
      if (activeMenuSource === "menu-set" && menuSets.currentMenuSet) {
        menuSets.updateDraft(menuSets.draftName, [
          ...menuSets.draftItems,
          {
            id: null,
            name,
            emoji,
            color: palette[menuSets.draftItems.length % palette.length],
          },
        ]);
      } else {
        anonymousMenuState.addMenu(name, emoji);
      }
      setSelected(null);
      clearRestaurantSearch();
    },
    [activeMenuSource, menuSets, anonymousMenuState, clearRestaurantSearch],
  );

  const handleRemoveMenu = useCallback(
    (id: string) => {
      if (rouletteMenus.length <= 2 || isSpinning) return;
      if (activeMenuSource === "menu-set" && menuSets.currentMenuSet) {
        menuSets.updateDraft(
          menuSets.draftName,
          menuSets.draftItems.filter(
            (item, index) => (item.id ?? `draft-new-${index}`) !== id,
          ),
        );
      } else {
        anonymousMenuState.removeMenu(id);
      }
      setSelected(null);
      wheelRef.current?.resetRotation();
      clearRestaurantSearch();
    },
    [
      rouletteMenus.length,
      isSpinning,
      activeMenuSource,
      menuSets,
      anonymousMenuState,
      clearRestaurantSearch,
    ],
  );

  const handleResetMenus = useCallback(() => {
    if (isSpinning) return;
    if (activeMenuSource === "menu-set" && menuSets.currentMenuSet) {
      menuSets.updateDraft(
        menuSets.draftName,
        initialMenus.map((menu) => ({
          id: null,
          name: menu.name,
          emoji: menu.emoji,
          color: menu.color,
        })),
      );
    } else {
      anonymousMenuState.resetMenus();
    }
    setSelected(null);
    setCoordinates(null);
    setLocationStatus("idle");
    wheelRef.current?.resetRotation();
    clearRestaurantSearch();
  }, [
    isSpinning,
    activeMenuSource,
    menuSets,
    anonymousMenuState,
    clearRestaurantSearch,
  ]);

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

  const handleMenuSetSelect = useCallback((id: string) => {
    if (!menuSets.selectMenuSet(id)) return;
    setActiveMenuSource("menu-set");
    setRouletteResetKey((key) => key + 1);
    setSelected(null);
    clearRestaurantSearch();
  }, [menuSets, clearRestaurantSearch]);

  const handleMenuSetCreateNew = useCallback(async () => {
    if (!newMenuSetName.trim()) return;
    const items: MenuSetItemRequest[] = rouletteMenus.map((menu) => ({
      id: null,
      name: menu.name,
      emoji: menu.emoji,
      color: menu.color,
    }));
    const created = await menuSets.createNew(newMenuSetName.trim(), items);
    if (!created) return;
    setActiveMenuSource("menu-set");
    setIsNewMenuSetFormOpen(false);
    setNewMenuSetName("");
    setRouletteResetKey((key) => key + 1);
  }, [menuSets, newMenuSetName, rouletteMenus]);

  const handleMenuSetDraftChange = useCallback(
    (name: string, items: MenuSetItemRequest[]) => {
      menuSets.updateDraft(name, items);
      setSelected(null);
      clearRestaurantSearch();
    },
    [menuSets, clearRestaurantSearch],
  );

  const handleMenuSetSave = useCallback(() => {
    void menuSets.saveCurrent();
  }, [menuSets]);

  const handleMenuSetArchive = useCallback(() => {
    if (confirm("이 메뉴판을 보관하시겠습니까?")) {
      void menuSets.archiveCurrent();
    }
  }, [menuSets]);

  const handleMenuSetDefault = useCallback(() => {
    void menuSets.setDefault();
  }, [menuSets]);

  const handleConflictSaveAsNew = useCallback(async () => {
    if (!conflictMenuSetName.trim()) return;
    const created = await menuSets.saveConflictAsNew(conflictMenuSetName.trim());
    if (!created) return;
    setConflictMenuSetName("");
    setActiveMenuSource("menu-set");
    setRouletteResetKey((key) => key + 1);
  }, [menuSets, conflictMenuSetName]);

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

      {isAuthenticated && menuSetsEnabled && firstLoginPrompt.show && (
        <section className="first-login-prompt" aria-label="메뉴판 전환">
          <div className="prompt-content">
            <h3>메뉴판을 어떻게 할까요?</h3>
            <p>현재 편집 중인 메뉴를 새 메뉴판으로 저장하거나, 서버에서 불러올 수 있습니다.</p>
            <div className="prompt-options">
              <div className="prompt-option">
                <label htmlFor="first-login-name">메뉴판 이름</label>
                <input
                  id="first-login-name"
                  type="text"
                  value={firstLoginName}
                  onChange={(e) => setFirstLoginName(e.target.value)}
                  placeholder="예: 회사 점심"
                  maxLength={30}
                />
                <button
                  type="button"
                  onClick={handleFirstLoginSaveAsNew}
                  disabled={!firstLoginName.trim()}
                >
                  현재 메뉴를 새 메뉴판으로 저장
                </button>
              </div>
              <div className="prompt-option">
                <button
                  type="button"
                  onClick={handleFirstLoginLoadDefault}
                  disabled={!menuSets.currentMenuSet}
                >
                  서버 기본 메뉴판 불러오기
                </button>
              </div>
              <div className="prompt-option">
                <button type="button" onClick={handleFirstLoginKeepAnonymous}>
                  지금은 익명 후보 계속 사용
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {isAuthenticated && menuSetsEnabled && (
        <section className="menu-set-section" aria-label="메뉴판 관리">
          <MenuSetSelector
            menuSets={menuSets.menuSets}
            currentId={
              activeMenuSource === "menu-set"
                ? menuSets.currentMenuSet?.id ?? null
                : null
            }
            isLoading={menuSets.isLoading}
            onSelect={handleMenuSetSelect}
            onCreateNew={() => setIsNewMenuSetFormOpen(true)}
          />
          {isNewMenuSetFormOpen && (
            <div className="menu-set-create-form">
              <label htmlFor="new-menu-set-name">새 메뉴판 이름</label>
              <input
                id="new-menu-set-name"
                type="text"
                value={newMenuSetName}
                onChange={(event) => setNewMenuSetName(event.target.value)}
                maxLength={30}
                placeholder="예: 회사 점심"
              />
              <button
                type="button"
                onClick={() => void handleMenuSetCreateNew()}
                disabled={!newMenuSetName.trim() || menuSets.saveStatus === "saving"}
              >
                현재 후보로 만들기
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNewMenuSetFormOpen(false);
                  setNewMenuSetName("");
                }}
              >
                취소
              </button>
            </div>
          )}
          <MenuSetSaveStatus
            status={menuSets.saveStatus}
            error={menuSets.error}
            conflictName={conflictMenuSetName}
            onConflictNameChange={setConflictMenuSetName}
            onReloadConflict={() => void menuSets.reloadConflict()}
            onSaveConflictAsNew={() => void handleConflictSaveAsNew()}
            onClearError={menuSets.clearError}
            onRetry={menuSets.retryLastSave}
          />
          {activeMenuSource === "menu-set" && menuSets.currentMenuSet && (
            <div className="menu-set-actions-bar">
              <button
                type="button"
                onClick={handleMenuSetDefault}
                disabled={menuSets.currentMenuSet.isDefault}
              >
                {menuSets.currentMenuSet.isDefault ? "기본 메뉴판" : "기본으로 설정"}
              </button>
              <button type="button" onClick={handleMenuSetArchive}>
                보관
              </button>
            </div>
          )}
          {activeMenuSource === "menu-set" && menuSets.currentMenuSet && (
            <MenuSetEditor
              menuSet={menuSets.currentMenuSet}
              draftName={menuSets.draftName}
              draftItems={menuSets.draftItems}
              saveStatus={menuSets.saveStatus}
              onDraftChange={handleMenuSetDraftChange}
              onSave={handleMenuSetSave}
            />
          )}
        </section>
      )}

      <section className="game-board" aria-label="메뉴 룰렛">
        <RouletteWheel
          ref={wheelRef}
          key={rouletteResetKey}
          menus={rouletteMenus}
          onSpinStart={handleSpinStart}
          onSpinComplete={handleSpinComplete}
        />

        <MenuEditor
          menus={rouletteMenus}
          isSpinning={isSpinning}
          resetKey={anonymousMenuState.resetKey}
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
