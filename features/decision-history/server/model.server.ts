export type DecisionMenuSnapshot = {
  name: string;
  emoji: string;
  color: string;
};

export type DecisionSourceSnapshot =
  | { type: "temporary"; menuSetId: null; menuSetName: null }
  | { type: "menu-set"; menuSetId: string; menuSetName: string };

export type DecisionHistoryRecord = {
  id: string;
  ownerUserId: string;
  clientRequestId: string;
  selected: DecisionMenuSnapshot;
  candidates: DecisionMenuSnapshot[];
  source: DecisionSourceSnapshot;
  createdAt: number;
};

export type CreateDecisionCommand = {
  clientRequestId: string;
  selected: DecisionMenuSnapshot;
  candidates: DecisionMenuSnapshot[];
  source: DecisionSourceSnapshot;
};

export type CreateDecisionResult = {
  record: DecisionHistoryRecord;
  created: boolean;
};
