"use client";

import { forwardRef, type ReactNode } from "react";
import type { MenuItem } from "../shared/contract.ts";
import type { Restaurant } from "../../restaurants/shared/contract.ts";
import type { Coordinates } from "../../restaurants/client/types.ts";
import KakaoRestaurantMap from "../../restaurants/client/KakaoRestaurantMap.tsx";
import RestaurantResults from "../../restaurants/client/RestaurantResults.tsx";

type LocationStatus = "idle" | "loading" | "ready" | "denied";
type RestaurantStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing-key"
  | "unauthorized"
  | "rate-limited"
  | "error";

type RouletteResultProps = {
  selected: MenuItem | null;
  coordinates: Coordinates | null;
  restaurants: Restaurant[];
  locationStatus: LocationStatus;
  restaurantStatus: RestaurantStatus;
  restaurantMessage: string;
  onRequestLocation: () => void;
  action?: ReactNode;
};

const RouletteResult = forwardRef<HTMLDivElement, RouletteResultProps>(
  function RouletteResult(
    {
      selected,
      coordinates,
      restaurants,
      locationStatus,
      restaurantStatus,
      restaurantMessage,
      onRequestLocation,
      action,
    },
    ref,
  ) {
    return (
      <section className="result-section" ref={ref} aria-live="polite">
        <div className="ticket-corner top-left" />
        <div className="ticket-corner top-right" />
        <div className="result-intro">
          <span>STEP 02</span>
          <h2>
            {selected
              ? "오늘의 메뉴가 정해졌어요!"
              : "룰렛을 돌리면 여기에 결과가 나와요"}
          </h2>
          <p>
            {selected
              ? "이제 가까운 곳에서 맛있는 한 끼를 찾아볼까요?"
              : "운명에 맡길 준비가 됐다면 위의 버튼을 눌러보세요."}
          </p>
        </div>

        <div className={`result-card ${selected ? "has-result" : ""}`}>
          {selected ? (
            <>
              <div
                className={`selected-food ${coordinates ? "has-map" : ""}`}
                style={
                  coordinates ? undefined : { backgroundColor: selected.color }
                }
              >
                {coordinates ? (
                  <KakaoRestaurantMap
                    coordinates={coordinates}
                    restaurants={restaurants}
                    selectedColor={selected.color}
                    selectedEmoji={selected.emoji}
                    selectedName={selected.name}
                  />
                ) : (
                  <>
                    <span>{selected.emoji}</span>
                    <small>TODAY&apos;S PICK</small>
                    <strong>{selected.name}</strong>
                  </>
                )}
              </div>
              <div className="map-search">
                {action}
                <div className="location-row">
                  <div>
                    <span className="pin-icon" aria-hidden="true">
                      ●
                    </span>
                    <div>
                      <strong>
                        {locationStatus === "ready"
                          ? "현재 위치를 찾았어요"
                          : "내 주변에서 찾기"}
                      </strong>
                      <small>
                        {locationStatus === "loading" &&
                          "위치를 확인하고 있어요..."}
                        {locationStatus === "ready" &&
                          "현재 위치 기준으로 식당을 검색해요."}
                        {locationStatus === "denied" &&
                          "위치 없이도 지도에서 검색할 수 있어요."}
                        {locationStatus === "idle" &&
                          "더 가까운 식당을 찾으려면 위치를 알려주세요."}
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onRequestLocation}
                    disabled={
                      locationStatus === "loading" ||
                      restaurantStatus === "loading"
                    }
                  >
                    {locationStatus === "loading" && "위치 확인 중"}
                    {locationStatus !== "loading" &&
                      restaurantStatus === "loading" &&
                      "검색 중"}
                    {locationStatus === "ready" &&
                      restaurantStatus !== "loading" &&
                      "다시 검색"}
                    {locationStatus !== "loading" &&
                      locationStatus !== "ready" &&
                      restaurantStatus !== "loading" &&
                      "내 위치 사용"}
                  </button>
                </div>

                <RestaurantResults
                  restaurants={restaurants}
                  status={restaurantStatus}
                  message={restaurantMessage}
                />
              </div>
            </>
          ) : (
            <div className="empty-result">
              <span aria-hidden="true">?</span>
              <p>
                오늘의 한 끼는
                <br />
                무엇이 될까요?
              </p>
            </div>
          )}
        </div>
        <div className="ticket-corner bottom-left" />
        <div className="ticket-corner bottom-right" />
      </section>
    );
  },
);

export default RouletteResult;
