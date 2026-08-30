"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseRestaurantSearchResponse } from "@/features/restaurants/client/api";
import type { Restaurant } from "@/features/restaurants/shared/contract";
import type { Coordinates } from "@/features/restaurants/client/types";
import type { MenuItem } from "@/features/roulette/shared/contract";
import {
  LOCATION_TIMEOUT_MS,
  palette,
} from "@/features/roulette/shared/constants";
import MenuEditor from "@/features/roulette/client/MenuEditor";
import RouletteWheel from "@/features/roulette/client/RouletteWheel";
import type { RouletteWheelHandle } from "@/features/roulette/client/RouletteWheel";
import RouletteResult from "@/features/roulette/client/RouletteResult";
import UserMenu from "@/features/auth/client/UserMenu";
import DecisionHistoryPanel from "@/features/decision-history/client/DecisionHistoryPanel";
import DecisionRecorder from "@/features/decision-history/client/DecisionRecorder";
import { useMenuState } from "@/features/roulette/client/useMenuState";
import { useAuth } from "@/features/auth/client/AuthProvider";
import { useMenuSets } from "@/features/menu-sets/client/hooks";
import MenuSetSelector from "@/features/menu-sets/client/MenuSetSelector";
import MenuSetSaveStatus from "@/features/menu-sets/client/MenuSetSaveStatus";
import MenuSetActionsMenu from "@/features/menu-sets/client/MenuSetActionsMenu";
import MenuSetInfoTooltip from "@/features/menu-sets/client/MenuSetInfoTooltip";
import MenuSetCreateDialog from "@/features/menu-sets/client/MenuSetCreateDialog";
import type { MenuSetItemRequest } from "@/features/menu-sets/shared/contract";
import { MENU_SET_NAME_MAX_LENGTH } from "@/features/menu-sets/shared/constants";
import {
  createDecisionDraft,
  type DecisionDraft,
} from "@/features/decision-history/client/decision-draft";

type ActiveMenuSource = "anonymous" | "menu-set";

export default function Home() {
  const anonymousMenuState = useMenuState();
  const {
    status,
    interactiveLoginVersion,
    onLogoutCleanup,
  } = useAuth();
  const isAuthenticated = status === "authenticated";

  const menuSets = useMenuSets();

  const [activeMenuSource, setActiveMenuSource] =
    useState<ActiveMenuSource>("anonymous");
  const [rouletteResetKey, setRouletteResetKey] = useState(0);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  const [firstLoginName, setFirstLoginName] = useState("");
  const [newMenuSetName, setNewMenuSetName] = useState("");
  const [isNewMenuSetFormOpen, setIsNewMenuSetFormOpen] = useState(false);
  const [isMenuSetEditing, setIsMenuSetEditing] = useState(false);
  const prevLoginVersionRef = useRef(0);

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
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(
    null,
  );
  const [decisionHistoryRefreshToken, setDecisionHistoryRefreshToken] =
    useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantStatus, setRestaurantStatus] = useState<
    | "idle"
    | "loading"
    | "ready"
    | "missing-key"
    | "unauthorized"
    | "rate-limited"
    | "error"
  >("idle");
  const [restaurantMessage, setRestaurantMessage] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<RouletteWheelHandle>(null);
  const restaurantRequestIdRef = useRef(0);

  const isBusy = menuSets.isLoading || menuSets.isMutating || isSpinning;

  useEffect(() => {
    if (
      menuSets.enabled &&
      interactiveLoginVersion > 0 &&
      interactiveLoginVersion !== prevLoginVersionRef.current
    ) {
      prevLoginVersionRef.current = interactiveLoginVersion;
      setActiveMenuSource("anonymous");
      setShowFirstLoginPrompt(true);
    }
  }, [interactiveLoginVersion, menuSets.enabled]);

  const confirmDiscardDraft = useCallback(() => {
    if (
      menuSets.saveStatus === "dirty" ||
      menuSets.saveStatus === "offline" ||
      menuSets.saveStatus === "conflict"
    ) {
      return confirm("저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?");
    }
    return true;
  }, [menuSets.saveStatus]);

  const handleFirstLoginSaveAsNew = useCallback(async () => {
    if (!firstLoginName.trim()) return;
    const items: MenuSetItemRequest[] = anonymousMenuState.menus.map(
      (menu) => ({
        id: null,
        name: menu.name,
        emoji: menu.emoji,
        color: menu.color,
      }),
    );
    const created = await menuSets.createNew(firstLoginName.trim(), items);
    if (!created) return;
    setActiveMenuSource("menu-set");
    setShowFirstLoginPrompt(false);
    setFirstLoginName("");
    setRouletteResetKey((key) => key + 1);
    setSelected(null);
    setDecisionDraft(null);
  }, [firstLoginName, anonymousMenuState.menus, menuSets]);

  const handleFirstLoginLoadDefault = useCallback(() => {
    const defaultMenuSet = menuSets.menuSets.find((item) => item.isDefault);
    if (!defaultMenuSet) return;
    menuSets.selectMenuSet(defaultMenuSet.id);
    setActiveMenuSource("menu-set");
    setShowFirstLoginPrompt(false);
    setRouletteResetKey((key) => key + 1);
    setSelected(null);
    setDecisionDraft(null);
  }, [menuSets]);

  const handleFirstLoginKeepAnonymous = useCallback(() => {
    setActiveMenuSource("anonymous");
    setShowFirstLoginPrompt(false);
  }, []);

  const clearRestaurantSearch = useCallback(() => {
    restaurantRequestIdRef.current += 1;
    setRestaurants([]);
    setRestaurantStatus("idle");
    setRestaurantMessage("");
  }, []);

  useEffect(
    () =>
      onLogoutCleanup(() => {
        setActiveMenuSource("anonymous");
        setShowFirstLoginPrompt(false);
        setFirstLoginName("");
        setIsNewMenuSetFormOpen(false);
        setIsMenuSetEditing(false);
        setNewMenuSetName("");
        setSelected(null);
        setDecisionDraft(null);
        setIsSpinning(false);
        setCoordinates(null);
        setLocationStatus("idle");
        wheelRef.current?.resetRotation();
        clearRestaurantSearch();
      }),
    [onLogoutCleanup, clearRestaurantSearch],
  );

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
    setDecisionDraft(null);
    setCoordinates(null);
    setLocationStatus("idle");
    clearRestaurantSearch();
    setIsSpinning(true);
  }, [clearRestaurantSearch]);

  const handleSpinComplete = useCallback(
    (item: MenuItem) => {
      setSelected(item);
      setDecisionDraft(
        createDecisionDraft(
          item,
          rouletteMenus,
          activeMenuSource === "menu-set" && menuSets.currentMenuSet
            ? {
                type: "menu-set",
                menuSetId: menuSets.currentMenuSet.id,
                menuSetName: menuSets.draftName,
              }
            : { type: "temporary", menuSetId: null, menuSetName: null },
        ),
      );
      setIsSpinning(false);
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 80);
    },
    [
      activeMenuSource,
      menuSets.currentMenuSet,
      menuSets.draftName,
      rouletteMenus,
    ],
  );

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
      setDecisionDraft(null);
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
      setDecisionDraft(null);
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
      menuSets.resetCurrentDraft();
    } else {
      anonymousMenuState.resetMenus();
    }
    setSelected(null);
    setDecisionDraft(null);
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
      {
        enableHighAccuracy: true,
        timeout: LOCATION_TIMEOUT_MS,
        maximumAge: 300000,
      },
    );
  }, [selected, coordinates, searchRestaurants]);

  const handleMenuSetSelect = useCallback(
    (id: string) => {
      if (isBusy) return;
      if (!confirmDiscardDraft()) return;
      if (!menuSets.selectMenuSet(id)) return;
      setActiveMenuSource("menu-set");
      setIsMenuSetEditing(false);
      setRouletteResetKey((key) => key + 1);
      setSelected(null);
      setDecisionDraft(null);
      clearRestaurantSearch();
    },
    [menuSets, clearRestaurantSearch, isBusy, confirmDiscardDraft],
  );

  const handleMenuSetCreateNew = useCallback(async () => {
    if (isBusy || menuSets.saveStatus === "conflict" || !newMenuSetName.trim())
      return;
    if (activeMenuSource === "menu-set" && !confirmDiscardDraft()) return;
    const items: MenuSetItemRequest[] = rouletteMenus.map((menu) => ({
      id: null,
      name: menu.name,
      emoji: menu.emoji,
      color: menu.color,
    }));
    const created = await menuSets.createNew(newMenuSetName.trim(), items);
    if (!created) return;
    setActiveMenuSource("menu-set");
    setIsMenuSetEditing(false);
    setIsNewMenuSetFormOpen(false);
    setNewMenuSetName("");
    setRouletteResetKey((key) => key + 1);
    setSelected(null);
    setDecisionDraft(null);
  }, [
    activeMenuSource,
    confirmDiscardDraft,
    isBusy,
    menuSets,
    newMenuSetName,
    rouletteMenus,
  ]);

  const handleMenuSetDraftChange = useCallback(
    (name: string, items: MenuSetItemRequest[]) => {
      menuSets.updateDraft(name, items);
      setSelected(null);
      setDecisionDraft(null);
      clearRestaurantSearch();
    },
    [menuSets, clearRestaurantSearch],
  );

  const handleMenuSetNameChange = useCallback(
    (name: string) => {
      handleMenuSetDraftChange(name, menuSets.draftItems);
    },
    [handleMenuSetDraftChange, menuSets.draftItems],
  );

  const handleMenuSetItemChange = useCallback(
    (index: number, field: "name" | "emoji" | "color", value: string) => {
      const nextItems = menuSets.draftItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      );
      handleMenuSetDraftChange(menuSets.draftName, nextItems);
    },
    [handleMenuSetDraftChange, menuSets.draftItems, menuSets.draftName],
  );

  const handleMenuSetSave = useCallback(async () => {
    const saved = await menuSets.saveCurrent();
    if (saved) setIsMenuSetEditing(false);
  }, [menuSets]);

  const handleMenuSetCancelEdit = useCallback(() => {
    if (isBusy || menuSets.saveStatus === "conflict") return;
    menuSets.resetCurrentDraft();
    setIsMenuSetEditing(false);
  }, [isBusy, menuSets]);

  const handleMenuSetArchive = useCallback(() => {
    if (isBusy || menuSets.saveStatus === "conflict") return;
    if (
      !confirm(
        "이 메뉴판을 삭제할까요? 현재는 다시 불러올 수 없지만, 메뉴는 룰렛에 그대로 남습니다.",
      )
    )
      return;
    if (!confirmDiscardDraft()) return;
    const snapshot = menuSets.draftItems.map((item) => ({
      id: item.id ?? crypto.randomUUID(),
      name: item.name,
      emoji: item.emoji,
      color: item.color,
    }));
    void menuSets.archiveCurrent().then((success) => {
      if (success) {
        anonymousMenuState.replaceMenus(snapshot);
        setActiveMenuSource("anonymous");
        setIsMenuSetEditing(false);
        setSelected(null);
        setDecisionDraft(null);
        setCoordinates(null);
        setLocationStatus("idle");
        clearRestaurantSearch();
      }
    });
  }, [
    isBusy,
    menuSets,
    anonymousMenuState,
    clearRestaurantSearch,
    confirmDiscardDraft,
  ]);

  const handleMenuSetDefault = useCallback(() => {
    if (isBusy || menuSets.saveStatus === "conflict") return;
    void menuSets.setDefault();
  }, [isBusy, menuSets]);

  const handleSwitchToAnonymous = useCallback(() => {
    if (isBusy) return;
    if (!confirmDiscardDraft()) return;
    menuSets.resetCurrentDraft();
    setActiveMenuSource("anonymous");
    setIsMenuSetEditing(false);
    setRouletteResetKey((key) => key + 1);
    setSelected(null);
    setDecisionDraft(null);
    clearRestaurantSearch();
  }, [isBusy, confirmDiscardDraft, clearRestaurantSearch, menuSets]);

  return (
    <main>
      <header className="site-header">
        <div className="header-brand">
          <a className="brand" href="#top" aria-label="오늘 뭐 먹지 홈">
            <span className="brand-mark" aria-hidden="true">
              ?
            </span>
            <span className="brand-text">오늘 뭐 먹지?</span>
          </a>
        </div>
        <div className="header-history">
          <DecisionHistoryPanel refreshToken={decisionHistoryRefreshToken} />
        </div>
        <div className="header-user">
          <UserMenu />
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

      {isAuthenticated && menuSets.enabled && showFirstLoginPrompt && (
        <section className="first-login-prompt" aria-label="메뉴판 전환">
          <div className="prompt-content">
            <h3>메뉴판을 어떻게 시작할까요?</h3>
            <p>현재 메뉴를 저장하거나 대표 메뉴판을 불러올 수 있습니다.</p>
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
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => void handleFirstLoginSaveAsNew()}
                  disabled={!firstLoginName.trim() || isBusy}
                >
                  현재 메뉴를 새 메뉴판으로 저장
                </button>
              </div>
              <div className="prompt-option">
                <button
                  type="button"
                  onClick={handleFirstLoginLoadDefault}
                  disabled={
                    !menuSets.menuSets.some((item) => item.isDefault) || isBusy
                  }
                >
                  대표 메뉴판 불러오기
                </button>
              </div>
              <div className="prompt-option">
                <button
                  type="button"
                  onClick={handleFirstLoginKeepAnonymous}
                  disabled={isBusy}
                >
                  저장하지 않고 계속 사용
                </button>
              </div>
            </div>
          </div>
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
          disabled={
            activeMenuSource === "menu-set"
              ? isBusy || menuSets.saveStatus === "conflict"
              : isSpinning
          }
          resetKey={
            activeMenuSource === "menu-set"
              ? rouletteResetKey
              : anonymousMenuState.resetKey
          }
          toolbar={
            isAuthenticated && menuSets.enabled ? (
              <div className="menu-set-toolbar-content">
                <MenuSetSelector
                  menuSets={menuSets.menuSets}
                  currentId={
                    activeMenuSource === "menu-set"
                      ? (menuSets.currentMenuSet?.id ?? null)
                      : null
                  }
                  isLoading={menuSets.isLoading}
                  disabled={isBusy || isMenuSetEditing}
                  createDisabled={
                    isMenuSetEditing || menuSets.saveStatus === "conflict"
                  }
                  onSelect={handleMenuSetSelect}
                  onCreateNew={() => setIsNewMenuSetFormOpen(true)}
                />
                <MenuSetInfoTooltip />
                {activeMenuSource === "menu-set" &&
                  menuSets.currentMenuSet &&
                  !isMenuSetEditing && (
                    <MenuSetActionsMenu
                      isDefault={menuSets.currentMenuSet.isDefault}
                      disabled={isBusy || menuSets.saveStatus === "conflict"}
                      onSetDefault={handleMenuSetDefault}
                      onSwitchToTemporary={handleSwitchToAnonymous}
                      onArchive={handleMenuSetArchive}
                    />
                  )}
              </div>
            ) : undefined
          }
          feedback={
            isAuthenticated && menuSets.enabled ? (
              <MenuSetSaveStatus
                status={menuSets.saveStatus}
                error={menuSets.error}
                isBusy={isBusy}
                onReloadConflict={() => void menuSets.reloadConflict()}
                onClearError={menuSets.clearError}
              />
            ) : undefined
          }
          onAdd={handleAddMenu}
          onRemove={handleRemoveMenu}
          onReset={handleResetMenus}
          savedMenu={
            activeMenuSource === "menu-set" && menuSets.currentMenuSet
              ? {
                  id: menuSets.currentMenuSet.id,
                  name: menuSets.draftName,
                  isDefault: menuSets.currentMenuSet.isDefault,
                  isEditing: isMenuSetEditing,
                  nameMaxLength: MENU_SET_NAME_MAX_LENGTH,
                  saveLabel:
                    menuSets.saveStatus === "saving"
                      ? "저장 중..."
                      : menuSets.saveStatus === "offline"
                        ? "다시 저장"
                        : "변경사항 저장",
                  canSave:
                    menuSets.saveStatus === "dirty" ||
                    menuSets.saveStatus === "offline",
                  onNameChange: handleMenuSetNameChange,
                  onItemChange: handleMenuSetItemChange,
                  onBeginEdit: () => setIsMenuSetEditing(true),
                  onCancelEdit: handleMenuSetCancelEdit,
                  onSave: () => void handleMenuSetSave(),
                }
              : undefined
          }
        />
      </section>

      {isNewMenuSetFormOpen && (
        <MenuSetCreateDialog
          name={newMenuSetName}
          nameMaxLength={MENU_SET_NAME_MAX_LENGTH}
          disabled={isBusy || menuSets.saveStatus === "conflict"}
          onNameChange={setNewMenuSetName}
          onCreate={() => void handleMenuSetCreateNew()}
          onCancel={() => {
            setIsNewMenuSetFormOpen(false);
            setNewMenuSetName("");
          }}
        />
      )}

      <RouletteResult
        ref={resultRef}
        selected={selected}
        coordinates={coordinates}
        restaurants={restaurants}
        locationStatus={locationStatus}
        restaurantStatus={restaurantStatus}
        restaurantMessage={restaurantMessage}
        onRequestLocation={requestLocation}
        action={
          <DecisionRecorder
            draft={decisionDraft}
            onSaved={() => setDecisionHistoryRefreshToken((token) => token + 1)}
          />
        }
      />

      <footer>
        <p>오늘 뭐 먹지?</p>
        <span>메뉴 고민은 룰렛에게, 맛있는 식사는 당신에게.</span>
        <a href="#top">맨 위로 ↑</a>
      </footer>
    </main>
  );
}
