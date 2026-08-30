import type {
  DecisionHistoryCreateRequest,
  DecisionHistoryCreateResponse,
  DecisionHistoryDeleteAllResponse,
  DecisionHistoryDeleteResponse,
  DecisionHistoryError,
  DecisionHistoryErrorCode,
  DecisionHistoryListResponse,
  DecisionHistoryResponse,
} from "../shared/contract.ts";
import { DECISION_HISTORY_LIMIT } from "../shared/constants.ts";
import { MAX_MENUS, MIN_MENUS } from "../../roulette/shared/constants.ts";

export type DecisionHistoryClientFailure =
  | "http"
  | "network"
  | "aborted"
  | "parse";

type ClientResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: DecisionHistoryError;
      failure: DecisionHistoryClientFailure;
    };

export type DecisionHistoryCreateResult =
  ClientResult<DecisionHistoryCreateResponse>;
export type DecisionHistoryListResult =
  ClientResult<DecisionHistoryListResponse>;
export type DecisionHistoryDeleteResult =
  ClientResult<DecisionHistoryDeleteResponse>;
export type DecisionHistoryDeleteAllResult =
  ClientResult<DecisionHistoryDeleteAllResponse>;

export type DecisionHistoryApiClient = {
  createDecision(
    input: DecisionHistoryCreateRequest,
    signal?: AbortSignal,
  ): Promise<DecisionHistoryCreateResult>;
  listDecisions(signal?: AbortSignal): Promise<DecisionHistoryListResult>;
  deleteDecision(
    id: string,
    signal?: AbortSignal,
  ): Promise<DecisionHistoryDeleteResult>;
  deleteAllDecisions(
    signal?: AbortSignal,
  ): Promise<DecisionHistoryDeleteAllResult>;
};

export type DecisionHistoryCreateApiClient = Pick<
  DecisionHistoryApiClient,
  "createDecision"
>;

const codes = new Set<DecisionHistoryErrorCode>([
  "UNAUTHORIZED",
  "DECISION_HISTORY_NOT_FOUND",
  "INVALID_DECISION_HISTORY",
  "FEATURE_DISABLED",
  "SERVER_CONFIG_ERROR",
  "RATE_LIMITED",
  "INVALID_ORIGIN",
  "INTERNAL_ERROR",
]);

const internal = (message: string): DecisionHistoryError => ({
  error: { code: "INTERNAL_ERROR", message },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.emoji === "string" &&
    value.emoji.length > 0 &&
    typeof value.color === "string" &&
    value.color.length > 0
  );
}

function validDecision(value: unknown): value is DecisionHistoryResponse {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return false;

  const source = value.source;
  const validSource =
    isRecord(source) &&
    (source.type === "temporary"
      ? source.menuSetId === null && source.menuSetName === null
      : source.type === "menu-set" &&
        typeof source.menuSetId === "string" &&
        source.menuSetId.length > 0 &&
        typeof source.menuSetName === "string" &&
        source.menuSetName.length > 0);

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    validSnapshot(value.selected) &&
    value.candidates.length >= MIN_MENUS &&
    value.candidates.length <= MAX_MENUS &&
    value.candidates.every(validSnapshot) &&
    validSource &&
    typeof value.createdAt === "number" &&
    Number.isSafeInteger(value.createdAt) &&
    value.createdAt >= 0 &&
    value.createdAt <= 8_640_000_000_000_000
  );
}

const validCreate = (
  value: unknown,
): value is DecisionHistoryCreateResponse =>
  isRecord(value) &&
  typeof value.created === "boolean" &&
  validDecision(value.decision);

const validList = (value: unknown): value is DecisionHistoryListResponse =>
  isRecord(value) &&
  Array.isArray(value.decisions) &&
  value.decisions.length <= DECISION_HISTORY_LIMIT &&
  value.decisions.every(validDecision);

const validDelete = (value: unknown): value is DecisionHistoryDeleteResponse =>
  isRecord(value) && value.ok === true;

const validDeleteAll = (
  value: unknown,
): value is DecisionHistoryDeleteAllResponse =>
  isRecord(value) &&
  typeof value.deletedCount === "number" &&
  Number.isSafeInteger(value.deletedCount) &&
  value.deletedCount >= 0;

function validError(value: unknown): value is DecisionHistoryError {
  const error = isRecord(value) ? value.error : null;
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    codes.has(error.code as DecisionHistoryErrorCode) &&
    typeof error.message === "string"
  );
}

function aborted(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function createDecisionHistoryApiClient(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): DecisionHistoryApiClient {
  async function request<T>(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    validate: (value: unknown) => value is T,
  ): Promise<ClientResult<T>> {
    try {
      const response = await fetcher(path, {
        ...init,
        cache: "no-store",
        headers: { Accept: "application/json", ...init.headers },
        signal,
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          error: internal("서버 응답을 해석하지 못했습니다."),
          failure: "parse",
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          error: validError(body)
            ? body
            : internal("요청 처리에 실패했습니다."),
          failure: "http",
        };
      }

      return validate(body)
        ? { ok: true, data: body }
        : {
            ok: false,
            error: internal("응답 형식이 올바르지 않습니다."),
            failure: "parse",
          };
    } catch (error) {
      const wasAborted = aborted(error, signal);
      return {
        ok: false,
        error: internal(
          wasAborted
            ? "요청이 취소되었습니다."
            : "서버에 연결하지 못했습니다.",
        ),
        failure: wasAborted ? "aborted" : "network",
      };
    }
  }

  return {
    createDecision(input, signal) {
      return request(
        "/api/decision-history",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        signal,
        validCreate,
      );
    },
    listDecisions(signal) {
      return request(
        "/api/decision-history",
        { method: "GET" },
        signal,
        validList,
      );
    },
    deleteDecision(id, signal) {
      return request(
        `/api/decision-history/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        signal,
        validDelete,
      );
    },
    deleteAllDecisions(signal) {
      return request(
        "/api/decision-history",
        { method: "DELETE" },
        signal,
        validDeleteAll,
      );
    },
  };
}

export const decisionHistoryApiClient = createDecisionHistoryApiClient();
