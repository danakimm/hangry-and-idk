"use client";

import type { Restaurant } from "../shared/contract.ts";

type RestaurantResultsProps = {
  restaurants: Restaurant[];
  status: "idle" | "loading" | "ready" | "missing-key" | "unauthorized" | "rate-limited" | "error";
  message: string;
};

function formatDistance(distanceMeters: number | null) {
  if (distanceMeters === null) return "거리 정보 없음";
  if (distanceMeters < 1_000) return `${distanceMeters}m`;
  return `${(distanceMeters / 1_000).toFixed(1)}km`;
}

export default function RestaurantResults({
  restaurants,
  status,
  message,
}: RestaurantResultsProps) {
  return (
    <div className="restaurant-results" aria-live="polite">
      <div className="restaurant-heading">
        <div>
          <span>NEARBY RESTAURANTS</span>
          <h3>내 주변 식당</h3>
        </div>
        {status === "ready" && restaurants.length > 0 && (
          <small>{restaurants.length}곳</small>
        )}
      </div>

      {status === "idle" && (
        <p className="restaurant-state">
          위치를 허용하면 선택된 메뉴를 파는 가까운 식당을 여기에 보여드려요.
        </p>
      )}
      {status === "loading" && (
        <p className="restaurant-state is-loading">가까운 식당을 찾고 있어요...</p>
      )}
      {status === "missing-key" && (
        <div className="restaurant-state api-ready">
          <strong>백엔드 연결 준비 완료</strong>
          <p>{message}</p>
          <code>KAKAO_REST_API_KEY</code>
        </div>
      )}
      {status === "unauthorized" && (
        <div className="restaurant-state is-error">
          <strong>로그인이 필요합니다</strong>
          <p>{message}</p>
        </div>
      )}
      {status === "rate-limited" && (
        <div className="restaurant-state is-error">
          <strong>요청이 너무 많습니다</strong>
          <p>{message}</p>
        </div>
      )}
      {status === "error" && (
        <p className="restaurant-state is-error">{message}</p>
      )}
      {status === "ready" && restaurants.length === 0 && (
        <p className="restaurant-state">반경 5km 안에서 검색 결과를 찾지 못했어요.</p>
      )}
      {status === "ready" && restaurants.length > 0 && (
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
  );
}
