import type {
  DecisionHistoryCreateRequest,
  DecisionHistoryCreateResponse,
  DecisionHistoryError,
  DecisionHistoryErrorCode,
} from "../shared/contract.ts";

export type DecisionHistoryClientFailure =
  "http" | "network" | "aborted" | "parse";
export type DecisionHistoryCreateResult =
  | { ok: true; data: DecisionHistoryCreateResponse }
  | {
      ok: false;
      error: DecisionHistoryError;
      failure: DecisionHistoryClientFailure;
    };
export type DecisionHistoryApiClient = {
  createDecision(
    input: DecisionHistoryCreateRequest,
    signal?: AbortSignal,
  ): Promise<DecisionHistoryCreateResult>;
};

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
function validSnapshot(value: unknown): boolean {
  const x = value as Record<string, unknown>;
  return (
    !!x &&
    typeof x === "object" &&
    typeof x.name === "string" &&
    x.name.length > 0 &&
    typeof x.emoji === "string" &&
    x.emoji.length > 0 &&
    typeof x.color === "string" &&
    x.color.length > 0
  );
}
function validResponse(value: unknown): value is DecisionHistoryCreateResponse {
  const x = value as Record<string, unknown>;
  const d = x?.decision as Record<string, unknown>;
  const source = d?.source as Record<string, unknown>;
  const validSource =
    source?.type === "temporary"
      ? source.menuSetId === null && source.menuSetName === null
      : source?.type === "menu-set" &&
        typeof source.menuSetId === "string" &&
        source.menuSetId.length > 0 &&
        typeof source.menuSetName === "string" &&
        source.menuSetName.length > 0;
  return (
    !!x &&
    typeof x === "object" &&
    typeof x.created === "boolean" &&
    !!d &&
    typeof d.id === "string" &&
    d.id.length > 0 &&
    validSnapshot(d.selected) &&
    Array.isArray(d.candidates) &&
    d.candidates.length >= 2 &&
    d.candidates.length <= 10 &&
    d.candidates.every(validSnapshot) &&
    validSource &&
    typeof d.createdAt === "number" &&
    Number.isSafeInteger(d.createdAt) &&
    d.createdAt >= 0
  );
}
function validError(value: unknown): value is DecisionHistoryError {
  const e = (value as Record<string, unknown>)?.error as Record<
    string,
    unknown
  >;
  return (
    !!e &&
    typeof e.code === "string" &&
    codes.has(e.code as DecisionHistoryErrorCode) &&
    typeof e.message === "string"
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
  return {
    async createDecision(input, signal) {
      try {
        const response = await fetcher("/api/decision-history", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(input),
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
        if (!response.ok)
          return {
            ok: false,
            error: validError(body)
              ? body
              : internal("요청 처리에 실패했습니다."),
            failure: "http",
          };
        return validResponse(body)
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
    },
  };
}
export const decisionHistoryApiClient = createDecisionHistoryApiClient();
