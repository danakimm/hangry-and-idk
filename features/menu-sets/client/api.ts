"use client";

import type {
  MenuSetResponse,
  MenuSetListResponse,
  MenuSetCreateRequest,
  MenuSetUpdateRequest,
  MenuSetDeleteRequest,
  MenuSetError,
  MenuSetErrorCode,
  MenuSetItemResponse,
} from "../shared/contract.ts";

export type MenuSetClientFailure = "http" | "network" | "aborted" | "parse";

type ApiFailure = {
  ok: false;
  error: MenuSetError;
  failure: MenuSetClientFailure;
};

export type MenuSetApiResult =
  | { ok: true; data: MenuSetResponse }
  | ApiFailure;

export type MenuSetListApiResult =
  | { ok: true; data: MenuSetListResponse }
  | ApiFailure;

export type MenuSetMutationApiResult = { ok: true } | ApiFailure;

export type MenuSetApiClient = {
  fetchMenuSets(signal?: AbortSignal): Promise<MenuSetListApiResult>;
  fetchMenuSet(id: string, signal?: AbortSignal): Promise<MenuSetApiResult>;
  createMenuSet(input: MenuSetCreateRequest, signal?: AbortSignal): Promise<MenuSetApiResult>;
  updateMenuSet(id: string, input: MenuSetUpdateRequest, signal?: AbortSignal): Promise<MenuSetApiResult>;
  deleteMenuSet(id: string, input: MenuSetDeleteRequest, signal?: AbortSignal): Promise<MenuSetMutationApiResult>;
  setDefaultMenuSet(id: string, signal?: AbortSignal): Promise<MenuSetApiResult>;
};

const ERROR_CODES = new Set<MenuSetErrorCode>([
  "UNAUTHORIZED",
  "MENU_SET_NOT_FOUND",
  "MENU_SET_LIMIT_REACHED",
  "MENU_SET_VERSION_CONFLICT",
  "DUPLICATE_MENU_NAME",
  "INVALID_MENU_SET",
  "FEATURE_DISABLED",
  "SERVER_CONFIG_ERROR",
  "RATE_LIMITED",
  "INVALID_ORIGIN",
  "INTERNAL_ERROR",
]);

function clientError(message: string): MenuSetError {
  return { error: { code: "INTERNAL_ERROR", message } };
}

function isMenuSetItemResponse(value: unknown): value is MenuSetItemResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.emoji === "string" &&
    typeof obj.color === "string"
  );
}

export function isMenuSetResponse(value: unknown): value is MenuSetResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.name !== "string" ||
    !Number.isSafeInteger(obj.version) ||
    typeof obj.isDefault !== "boolean" ||
    typeof obj.createdAt !== "number" ||
    typeof obj.updatedAt !== "number" ||
    !Array.isArray(obj.items)
  ) {
    return false;
  }
  return obj.items.every(isMenuSetItemResponse);
}

export function isMenuSetListResponse(value: unknown): value is MenuSetListResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.menuSets) && obj.menuSets.every(isMenuSetResponse);
}

function isMenuSetError(value: unknown): value is MenuSetError {
  if (typeof value !== "object" || value === null) return false;
  const outer = value as Record<string, unknown>;
  if (typeof outer.error !== "object" || outer.error === null) return false;
  const error = outer.error as Record<string, unknown>;
  return (
    typeof error.code === "string" &&
    ERROR_CODES.has(error.code as MenuSetErrorCode) &&
    typeof error.message === "string"
  );
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (
    error instanceof DOMException && error.name === "AbortError"
  );
}

async function parseResponse<T>(
  response: Response,
  validate: (value: unknown) => value is T,
): Promise<{ ok: true; data: T } | ApiFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: clientError("서버 응답을 해석하지 못했습니다."),
      failure: "parse",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: isMenuSetError(body)
        ? body
        : clientError("요청 처리에 실패했습니다."),
      failure: "http",
    };
  }

  if (!validate(body)) {
    return {
      ok: false,
      error: clientError("응답 형식이 올바르지 않습니다."),
      failure: "parse",
    };
  }

  return { ok: true, data: body };
}

async function requestJson<T>(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  validate: (value: unknown) => value is T,
): Promise<{ ok: true; data: T } | ApiFailure> {
  try {
    const response = await fetcher(input, init);
    return parseResponse(response, validate);
  } catch (error) {
    const aborted = isAbort(error, init.signal ?? undefined);
    return {
      ok: false,
      error: clientError(
        aborted ? "요청이 취소되었습니다." : "서버에 연결하지 못했습니다.",
      ),
      failure: aborted ? "aborted" : "network",
    };
  }
}

export function createMenuSetApiClient(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): MenuSetApiClient {
  return {
    fetchMenuSets(signal) {
      return requestJson(
        fetcher,
        "/api/menu-sets",
        { cache: "no-store", headers: { Accept: "application/json" }, signal },
        isMenuSetListResponse,
      );
    },

    fetchMenuSet(id, signal) {
      return requestJson(
        fetcher,
        `/api/menu-sets/${encodeURIComponent(id)}`,
        { cache: "no-store", headers: { Accept: "application/json" }, signal },
        isMenuSetResponse,
      );
    },

    createMenuSet(input, signal) {
      return requestJson(
        fetcher,
        "/api/menu-sets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(input),
          signal,
        },
        isMenuSetResponse,
      );
    },

    updateMenuSet(id, input, signal) {
      return requestJson(
        fetcher,
        `/api/menu-sets/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(input),
          signal,
        },
        isMenuSetResponse,
      );
    },

    async deleteMenuSet(id, input, signal) {
      try {
        const response = await fetcher(`/api/menu-sets/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        if (response.ok) return { ok: true };

        const body: unknown = await response.json().catch(() => null);
        return {
          ok: false,
          error: isMenuSetError(body)
            ? body
            : clientError("메뉴판을 보관하지 못했습니다."),
          failure: "http",
        };
      } catch (error) {
        const aborted = isAbort(error, signal);
        return {
          ok: false,
          error: clientError(
            aborted ? "요청이 취소되었습니다." : "서버에 연결하지 못했습니다.",
          ),
          failure: aborted ? "aborted" : "network",
        };
      }
    },

    setDefaultMenuSet(id, signal) {
      return requestJson(
        fetcher,
        `/api/menu-sets/${encodeURIComponent(id)}/default`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({}),
          signal,
        },
        isMenuSetResponse,
      );
    },
  };
}

export const menuSetApiClient = createMenuSetApiClient();

export const fetchMenuSets = menuSetApiClient.fetchMenuSets;
export const fetchMenuSet = menuSetApiClient.fetchMenuSet;
export const createMenuSet = menuSetApiClient.createMenuSet;
export const updateMenuSet = menuSetApiClient.updateMenuSet;
export const deleteMenuSet = menuSetApiClient.deleteMenuSet;
export const setDefaultMenuSet = menuSetApiClient.setDefaultMenuSet;
