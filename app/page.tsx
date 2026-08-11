"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

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

const foodEmojis = ["🍜", "🍲", "🍛", "🥘", "🌮", "🍕", "🥪", "🍱"];

export default function Home() {
  const [menus, setMenus] = useState<MenuItem[]>(initialMenus);
  const [newMenu, setNewMenu] = useState("");
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const resultRef = useRef<HTMLDivElement>(null);

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

    const chosenIndex = Math.floor(Math.random() * menus.length);
    const currentAngle = ((rotation % 360) + 360) % 360;
    const alignment =
      ((360 - currentAngle - chosenIndex * sliceAngle) % 360 + 360) % 360;
    const nextRotation = rotation + 360 * 6 + alignment;

    setSelected(null);
    setCoordinates(null);
    setLocationStatus("idle");
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
        emoji: foodEmojis[index % foodEmojis.length],
        color: palette[index % palette.length],
      },
    ]);
    setNewMenu("");
    setSelected(null);
  };

  const removeMenu = (id: number) => {
    if (menus.length <= 2 || isSpinning) return;
    setMenus((current) => current.filter((menu) => menu.id !== id));
    setSelected(null);
    setRotation(0);
  };

  const resetMenus = () => {
    if (isSpinning) return;
    setMenus(initialMenus);
    setSelected(null);
    setRotation(0);
    setCoordinates(null);
    setLocationStatus("idle");
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }

    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        setLocationStatus("ready");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
  };

  const getMapUrl = (provider: "naver" | "kakao" | "google") => {
    if (!selected) return "#";
    const query = `${selected.name} 맛집`;
    const encoded = encodeURIComponent(query);

    if (provider === "naver") {
      const center = coordinates
        ? `?c=${coordinates.longitude},${coordinates.latitude},15,0,0,0,dh`
        : "";
      return `https://map.naver.com/p/search/${encoded}${center}`;
    }

    if (provider === "kakao") {
      return `https://map.kakao.com/link/search/${encoded}`;
    }

    if (coordinates) {
      return `https://www.google.com/maps/search/${encoded}/@${coordinates.latitude},${coordinates.longitude},15z`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
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
            <div>
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
                disabled={!newMenu.trim() || menus.length >= 10 || isSpinning}
                aria-label="메뉴 추가"
              >
                +
              </button>
            </div>
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
                        {locationStatus === "ready" && "지도 검색에 현재 위치를 반영할게요."}
                        {locationStatus === "denied" && "위치 없이도 지도에서 검색할 수 있어요."}
                        {locationStatus === "idle" && "더 가까운 식당을 찾으려면 위치를 알려주세요."}
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={requestLocation}
                    disabled={locationStatus === "loading" || locationStatus === "ready"}
                  >
                    {locationStatus === "ready" ? "위치 확인됨" : "내 위치 사용"}
                  </button>
                </div>

                <div className="map-links" aria-label={`${selected.name} 식당 지도 검색`}>
                  <a href={getMapUrl("naver")} target="_blank" rel="noreferrer">
                    <span className="map-logo naver">N</span>
                    <span><b>네이버지도</b><small>{selected.name} 맛집 찾기</small></span>
                    <i aria-hidden="true">↗</i>
                  </a>
                  <a href={getMapUrl("kakao")} target="_blank" rel="noreferrer">
                    <span className="map-logo kakao">K</span>
                    <span><b>카카오맵</b><small>{selected.name} 맛집 찾기</small></span>
                    <i aria-hidden="true">↗</i>
                  </a>
                  <a href={getMapUrl("google")} target="_blank" rel="noreferrer">
                    <span className="map-logo google">G</span>
                    <span><b>구글지도</b><small>{selected.name} 맛집 찾기</small></span>
                    <i aria-hidden="true">↗</i>
                  </a>
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
