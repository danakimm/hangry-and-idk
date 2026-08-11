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

export type RestaurantSearchError = {
  error: {
    code:
      | "INVALID_REQUEST"
      | "KAKAO_API_KEY_MISSING"
      | "KAKAO_API_TIMEOUT"
      | "KAKAO_API_ERROR"
      | "INTERNAL_ERROR";
    message: string;
  };
};
