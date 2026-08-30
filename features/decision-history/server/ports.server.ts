import type { CreateDecisionResult, DecisionHistoryRecord } from "./model.server.ts";

export type DecisionHistoryRepository = {
  createOrGet(record: DecisionHistoryRecord): Promise<CreateDecisionResult>;
  listByOwner(ownerUserId: string): Promise<DecisionHistoryRecord[]>;
  deleteByIdAndOwner(id: string, ownerUserId: string): Promise<boolean>;
  deleteAllByOwner(ownerUserId: string): Promise<number>;
};
