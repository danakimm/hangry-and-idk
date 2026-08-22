export type Restaurant = {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category: string;
  phone: string;
  distanceMeters: number | null;
  longitude: number;
  latitude: number;
  placeUrl: string;
};

export type RestaurantSearchResponse = {
  restaurants: Restaurant[];
  meta: {
    totalCount: number;
    isEnd: boolean;
  };
};

export type RestaurantSearchErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "KAKAO_API_KEY_MISSING"
  | "KAKAO_API_TIMEOUT"
  | "KAKAO_API_ERROR"
  | "INTERNAL_ERROR";

export type RestaurantSearchError = {
  error: {
    code: RestaurantSearchErrorCode;
    message: string;
  };
};
