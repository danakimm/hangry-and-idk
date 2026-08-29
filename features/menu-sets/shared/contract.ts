export type MenuSetItemResponse = {
  id: string;
  name: string;
  emoji: string;
  color: string;
};

export type MenuSetResponse = {
  id: string;
  name: string;
  version: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  items: MenuSetItemResponse[];
};

export type MenuSetListResponse = {
  menuSets: MenuSetResponse[];
};

export type MenuSetItemRequest = {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
};

export type MenuSetCreateRequest = {
  name: string;
  items: MenuSetItemRequest[];
};

export type MenuSetUpdateRequest = {
  version: number;
  name: string;
  items: MenuSetItemRequest[];
};

export type MenuSetDeleteRequest = {
  version: number;
};

export type MenuSetErrorCode =
  | "UNAUTHORIZED"
  | "MENU_SET_NOT_FOUND"
  | "MENU_SET_LIMIT_REACHED"
  | "MENU_SET_VERSION_CONFLICT"
  | "DUPLICATE_MENU_NAME"
  | "INVALID_MENU_SET"
  | "FEATURE_DISABLED"
  | "SERVER_CONFIG_ERROR"
  | "RATE_LIMITED"
  | "INVALID_ORIGIN"
  | "INTERNAL_ERROR";

export type MenuSetError = {
  error: {
    code: MenuSetErrorCode;
    message: string;
  };
};
