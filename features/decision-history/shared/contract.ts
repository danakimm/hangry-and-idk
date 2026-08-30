export type DecisionMenuSnapshotResponse = {
  name: string;
  emoji: string;
  color: string;
};

export type DecisionSourceResponse =
  | { type: "temporary"; menuSetId: null; menuSetName: null }
  | { type: "menu-set"; menuSetId: string; menuSetName: string };

export type DecisionHistoryResponse = {
  id: string;
  selected: DecisionMenuSnapshotResponse;
  candidates: DecisionMenuSnapshotResponse[];
  source: DecisionSourceResponse;
  createdAt: number;
};

export type DecisionHistoryListResponse = {
  decisions: DecisionHistoryResponse[];
};

export type DecisionHistoryCreateRequest = {
  clientRequestId: string;
  selected: DecisionMenuSnapshotResponse;
  candidates: DecisionMenuSnapshotResponse[];
  source: DecisionSourceResponse;
};

export type DecisionHistoryCreateResponse = {
  decision: DecisionHistoryResponse;
  created: boolean;
};

export type DecisionHistoryDeleteResponse = {
  ok: true;
};

export type DecisionHistoryDeleteAllResponse = {
  deletedCount: number;
};

export type DecisionHistoryErrorCode =
  | "UNAUTHORIZED"
  | "DECISION_HISTORY_NOT_FOUND"
  | "INVALID_DECISION_HISTORY"
  | "FEATURE_DISABLED"
  | "SERVER_CONFIG_ERROR"
  | "RATE_LIMITED"
  | "INVALID_ORIGIN"
  | "INTERNAL_ERROR";

export type DecisionHistoryError = {
  error: {
    code: DecisionHistoryErrorCode;
    message: string;
  };
};
