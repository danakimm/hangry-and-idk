"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type {
  Restaurant,
  RestaurantSearchError,
  RestaurantSearchResponse,
} from "../lib/restaurants";

type MenuItem = {
  id: number;
  name: string;
  emoji: string;
  color: string;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

const palette = [
  "#ef4938",
  "#f6c84a",
  "#2d7a57",
  "#f4ebd8",
  "#ee7654",
  "#8db99b",
  "#f0a43b",
  "#d9c8a4",
];

const initialMenus: MenuItem[] = [
  { id: 1, name: "한식", emoji: "🍚", color: palette[0] },
  { id: 2, name: "중식", emoji: "🥟", color: palette[1] },
  { id: 3, name: "일식", emoji: "🍣", color: palette[2] },
  { id: 4, name: "양식", emoji: "🍝", color: palette[3] },
  { id: 5, name: "분식", emoji: "🌶️", color: palette[4] },
  { id: 6, name: "치킨", emoji: "🍗", color: palette[5] },
  { id: 7, name: "버거", emoji: "🍔", color: palette[6] },
  { id: 8, name: "샐러드", emoji: "🥗", color: palette[7] },
];

const defaultMenuEmoji = "🍽️";
const customMenuEmojis = ["🍽️", "🍜", "🍲", "🍛", "🥘", "🌮", "🍕", "🥪", "🍱", "🥩"];
const fastApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  ?.trim()
  .replace(/\/+$/, "");

function formatDistance(distanceMeters: number | null) {
  if (distanceMeters === null) return "거리 정보 없음";
  if (distanceMeters < 1_000) return `${distanceMeters}m`;
  return `${(distanceMeters / 1_000).toFixed(1)}km`;
}

function getRandomIndex(length: number) {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return Math.floor((values[0] / 2 ** 32) * length);
}

export default function Home() {
  const [menus, setMenus] = useState<MenuItem[]>(initialMenus);
  const [newMenu, setNewMenu] = useState("");
  const [newMenuEmoji, setNewMenuEmoji] = useState(defaultMenuEmoji);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantStatus, setRestaurantStatus] = useState<
    "idle" | "loading" | "ready" | "missing-backend" | "missing-key" | "error"
  >("idle");
  const [restaurantMessage, setRestaurantMessage] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const restaurantRequestIdRef = useRef(0);

  const clearRestaurantSearch = () => {
    restaurantRequestIdRef.current += 1;
    setRestaurants([]);
    setRestaurantStatus("idle");
    setRestaurantMessage("");
  };

  const sliceAngle = 360 / menus.length;
  const wheelBackground = useMemo(() => {
    const stops = menus.map((menu, index) => {
      const start = index * sliceAngle;
      const end = (index + 1) * sliceAngle;
      return `${menu.color} ${start}deg ${end}deg`;
    });
    return `conic-gradient(from ${-sliceAngle / 2}deg, ${stops.join(", ")})`;
  }, [menus, sliceAngle]);

  const spinWheel = () => {
    if (isSpinning || menus.length < 2) return;

    const chosenIndex = getRandomIndex(menus.length);
    const currentAngle = ((rotation % 360) + 360) % 360;
    const alignment =
      ((360 - currentAngle - chosenIndex * sliceAngle) % 360 + 360) % 360;
    const nextRotation = rotation + 360 * 6 + alignment;

    setSelected(null);
    setCoordinates(null);
    setLocationStatus("idle");
    clearRestaurantSearch();
    setIsSpinning(true);
    setRotation(nextRotation);

    window.setTimeout(() => {
      setSelected(menus[chosenIndex]);
      setIsSpinning(false);
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    }, 4100);
  };

  const addMenu = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newMenu.trim();
    if (!name || menus.length >= 10) return;

    const index = menus.length;
    setMenus((current) => [
      ...current,
      {
        id: Date.now(),
        name,
        emoji: newMenuEmoji,
        color: palette[index % palette.length],
      },
    ]);
    setNewMenu("");
    setNewMenuEmoji(defaultMenuEmoji);
    setIsEmojiPickerOpen(false);
    setSelected(null);
    clearRestaurantSearch();
  };

  const removeMenu = (id: number) => {
    if (menus.length <= 2 || isSpinning) return;
    setMenus((current) => current.filter((menu) => menu.id !== id));
    setSelected(null);
    setRotation(0);
    clearRestaurantSearch();
  };

  const resetMenus = () => {
    if (isSpinning) return;
    setMenus(initialMenus);
    setSelected(null);
    setRotation(0);
    setCoordinates(null);
    setLocationStatus("idle");
    setNewMenuEmoji(defaultMenuEmoji);
    setIsEmojiPickerOpen(false);
    clearRestaurantSearch();
  };

  const searchRestaurants = async (
    menuName: string,
    nextCoordinates: Coordinates,
    requestId: number,
  ) => {
    setRestaurants([]);
    setRestaurantMessage("");

    if (!fastApiBaseUrl) {
      setRestaurantStatus("missing-backend");
      setRestaurantMessage("FastAPI 서버 주소가 아직 설정되지 않았습니다.");
      return;
    }

    setRestaurantStatus("loading");

    const params = new URLSearchParams({
      menu: menuName,
      lat: String(nextCoordinates.latitude),
      lng: String(nextCoordinates.longitude),
    });

    try {
      const response = await fetch(`${fastApiBaseUrl}/api/restaurants?${params}`, {
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as
        | RestaurantSearchResponse
        | RestaurantSearchError;

      if (restaurantRequestIdRef.current !== requestId) return;

      if (!response.ok || "error" in data) {
        const error = "error" in data ? data.error : null;
        setRestaurantStatus(
          error?.code === "KAKAO_API_KEY_MISSING" ? "missing-key" : "error",
        );
        setRestaurantMessage(error?.message ?? "식당 검색에 실패했습니다.");
        return;
      }

      setRestaurants(data.restaurants);
      setRestaurantStatus("ready");
    } catch {
      if (restaurantRequestIdRef.current !== requestId) return;
      setRestaurantStatus("error");
      setRestaurantMessage("식당 검색 서버에 연결하지 못했습니다.");
    }
  };

  const requestLocation = () => {
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="오늘 뭐 먹지 홈">
          <span className="brand-mark" aria-hidden="true">?</span>
          <span>오늘 뭐 먹지?</span>
        </a>
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
        <div className="wheel-stage">
          <div className="stage-label">
            <span>STEP 01</span>
            <strong>룰렛 돌리기</strong>
          </div>

          <div className="wheel-wrap">
            <div className="pointer" aria-hidden="true">
              <span />
            </div>
            <div
              className={`wheel ${isSpinning ? "is-spinning" : ""}`}
              style={{
                background: wheelBackground,
                transform: `rotate(${rotation}deg)`,
              }}
              aria-hidden="true"
            >
              <div className="wheel-lines" />
              {menus.map((menu, index) => {
                const angle = index * sliceAngle;
                const radians = (angle * Math.PI) / 180;
                const left = 50 + 34 * Math.sin(radians);
                const top = 50 - 34 * Math.cos(radians);
                return (
                  <div
                    className="wheel-label"
                    key={menu.id}
                    style={{ left: `${left}%`, top: `${top}%` }}
                  >
                    <span>{menu.emoji}</span>
                    <b>{menu.name}</b>
                  </div>
                );
              })}
              <div className="wheel-center" />
            </div>
          </div>

          <button
            className="spin-button"
            type="button"
            onClick={spinWheel}
            disabled={isSpinning || menus.length < 2}
          >
            <span>{isSpinning ? "고르는 중..." : "룰렛 돌리기"}</span>
            <span aria-hidden="true">→</span>
          </button>
          <p className="spin-hint">최소 2개, 최대 10개의 메뉴로 돌릴 수 있어요.</p>
        </div>

        <aside className="menu-panel">
          <div className="panel-heading">
            <div>
              <span>MY MENU LIST</span>
              <h2>오늘의 후보</h2>
            </div>
            <button type="button" className="text-button" onClick={resetMenus}>
              처음대로
            </button>
          </div>

          <ul className="menu-list" aria-label="룰렛 메뉴 목록">
            {menus.map((menu, index) => (
              <li key={menu.id}>
                <span className="menu-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="menu-emoji" aria-hidden="true">{menu.emoji}</span>
                <strong>{menu.name}</strong>
                <button
                  type="button"
                  onClick={() => removeMenu(menu.id)}
                  disabled={menus.length <= 2 || isSpinning}
                  aria-label={`${menu.name} 삭제`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <form className="menu-form" onSubmit={addMenu}>
            <label htmlFor="menu-input">먹고 싶은 메뉴 직접 추가</label>
            <div className="menu-input-row">
              <button
                type="button"
                className="emoji-trigger"
                onClick={() => setIsEmojiPickerOpen((current) => !current)}
                disabled={menus.length >= 10 || isSpinning}
                aria-haspopup="listbox"
                aria-expanded={isEmojiPickerOpen}
                aria-label={`메뉴 아이콘 ${newMenuEmoji}, 변경`}
              >
                {newMenuEmoji}
              </button>
              <input
                id="menu-input"
                value={newMenu}
                onChange={(event) => setNewMenu(event.target.value)}
                placeholder="예: 쌀국수"
                maxLength={12}
                disabled={menus.length >= 10 || isSpinning}
              />
              <button
                type="submit"
                className="add-menu-button"
                disabled={!newMenu.trim() || menus.length >= 10 || isSpinning}
                aria-label="메뉴 추가"
              >
                +
              </button>
            </div>
            {isEmojiPickerOpen && (
              <div className="emoji-picker" role="listbox" aria-label="메뉴 아이콘 선택">
                {customMenuEmojis.map((emoji) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={newMenuEmoji === emoji}
                    aria-label={`${emoji} 아이콘 선택`}
                    key={emoji}
                    onClick={() => {
                      setNewMenuEmoji(emoji);
                      setIsEmojiPickerOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </form>
        </aside>
      </section>

      <section className="result-section" ref={resultRef} aria-live="polite">
        <div className="ticket-corner top-left" />
        <div className="ticket-corner top-right" />
        <div className="result-intro">
          <span>STEP 02</span>
          <h2>{selected ? "오늘의 메뉴가 정해졌어요!" : "룰렛을 돌리면 여기에 결과가 나와요"}</h2>
          <p>
            {selected
              ? "이제 가까운 곳에서 맛있는 한 끼를 찾아볼까요?"
              : "운명에 맡길 준비가 됐다면 위의 버튼을 눌러보세요."}
          </p>
        </div>

        <div className={`result-card ${selected ? "has-result" : ""}`}>
          {selected ? (
            <>
              <div className="selected-food" style={{ backgroundColor: selected.color }}>
                <span>{selected.emoji}</span>
                <small>TODAY&apos;S PICK</small>
                <strong>{selected.name}</strong>
              </div>
              <div className="map-search">
                <div className="location-row">
                  <div>
                    <span className="pin-icon" aria-hidden="true">●</span>
                    <div>
                      <strong>
                        {locationStatus === "ready" ? "현재 위치를 찾았어요" : "내 주변에서 찾기"}
                      </strong>
                      <small>
                        {locationStatus === "loading" && "위치를 확인하고 있어요..."}
                        {locationStatus === "ready" && "현재 위치 기준으로 식당을 검색해요."}
                        {locationStatus === "denied" && "위치 없이도 지도에서 검색할 수 있어요."}
                        {locationStatus === "idle" && "더 가까운 식당을 찾으려면 위치를 알려주세요."}
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={requestLocation}
                    disabled={locationStatus === "loading" || restaurantStatus === "loading"}
                  >
                    {locationStatus === "loading" && "위치 확인 중"}
                    {locationStatus !== "loading" && restaurantStatus === "loading" && "검색 중"}
                    {locationStatus === "ready" && restaurantStatus !== "loading" && "다시 검색"}
                    {locationStatus !== "loading" &&
                      locationStatus !== "ready" &&
                      restaurantStatus !== "loading" &&
                      "내 위치 사용"}
                  </button>
                </div>

                <div className="restaurant-results" aria-live="polite">
                  <div className="restaurant-heading">
                    <div>
                      <span>NEARBY RESTAURANTS</span>
                      <h3>내 주변 식당</h3>
                    </div>
                    {restaurantStatus === "ready" && restaurants.length > 0 && (
                      <small>{restaurants.length}곳</small>
                    )}
                  </div>

                  {restaurantStatus === "idle" && (
                    <p className="restaurant-state">
                      위치를 허용하면 선택된 메뉴를 파는 가까운 식당을 여기에 보여드려요.
                    </p>
                  )}
                  {restaurantStatus === "loading" && (
                    <p className="restaurant-state is-loading">가까운 식당을 찾고 있어요...</p>
                  )}
                  {restaurantStatus === "missing-key" && (
                    <div className="restaurant-state api-ready">
                      <strong>백엔드 연결 준비 완료</strong>
                      <p>{restaurantMessage}</p>
                      <code>KAKAO_REST_API_KEY</code>
                    </div>
                  )}
                  {restaurantStatus === "missing-backend" && (
                    <div className="restaurant-state api-ready">
                      <strong>FastAPI 연결 대기 중</strong>
                      <p>{restaurantMessage}</p>
                      <code>NEXT_PUBLIC_API_BASE_URL</code>
                    </div>
                  )}
                  {restaurantStatus === "error" && (
                    <p className="restaurant-state is-error">{restaurantMessage}</p>
                  )}
                  {restaurantStatus === "ready" && restaurants.length === 0 && (
                    <p className="restaurant-state">반경 5km 안에서 검색 결과를 찾지 못했어요.</p>
                  )}
                  {restaurantStatus === "ready" && restaurants.length > 0 && (
                    <ol className="restaurant-list">
                      {restaurants.map((restaurant, index) => (
                        <li key={restaurant.id}>
                          <span className="restaurant-rank">{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <div className="restaurant-name-row">
                              <strong>{restaurant.name}</strong>
                              <small>{formatDistance(restaurant.distanceMeters)}</small>
                            </div>
                            <p>{restaurant.roadAddress || restaurant.address}</p>
                          </div>
                          <a href={restaurant.placeUrl} target="_blank" rel="noreferrer">
                            상세 ↗
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

              </div>
            </>
          ) : (
            <div className="empty-result">
              <span aria-hidden="true">?</span>
              <p>오늘의 한 끼는<br />무엇이 될까요?</p>
            </div>
          )}
        </div>
        <div className="ticket-corner bottom-left" />
        <div className="ticket-corner bottom-right" />
      </section>

      <footer>
        <p>오늘 뭐 먹지?</p>
        <span>메뉴 고민은 룰렛에게, 맛있는 식사는 당신에게.</span>
        <a href="#top">맨 위로 ↑</a>
      </footer>
    </main>
  );
}
