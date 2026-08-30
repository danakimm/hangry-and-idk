import type { Clock, IdGenerator } from "../../../server/db/types.server.ts";
import type {
  CreateDecisionCommand,
  CreateDecisionResult,
  DecisionHistoryRecord,
} from "./model.server.ts";
import type { DecisionHistoryRepository } from "./ports.server.ts";
import { validateAndNormalizeDecision } from "./validation.server.ts";

export type DecisionHistoryErrorCode =
  | "INVALID_DECISION_HISTORY"
  | "DECISION_HISTORY_NOT_FOUND"
  | "INTERNAL_ERROR";
export type DecisionHistoryServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: DecisionHistoryErrorCode; message: string };
    };
export type DecisionHistoryService = {
  create(
    ownerUserId: string,
    command: unknown,
  ): Promise<DecisionHistoryServiceResult<CreateDecisionResult>>;
  createValidated(
    ownerUserId: string,
    command: CreateDecisionCommand,
  ): Promise<DecisionHistoryServiceResult<CreateDecisionResult>>;
  list(
    ownerUserId: string,
  ): Promise<DecisionHistoryServiceResult<DecisionHistoryRecord[]>>;
  deleteOne(
    id: string,
    ownerUserId: string,
  ): Promise<DecisionHistoryServiceResult<void>>;
  deleteAll(
    ownerUserId: string,
  ): Promise<DecisionHistoryServiceResult<{ deletedCount: number }>>;
};

export function createDecisionHistoryService(deps: {
  repository: DecisionHistoryRepository;
  idGenerator: IdGenerator;
  clock: Clock;
}): DecisionHistoryService {
  const { repository, idGenerator, clock } = deps;
  const error = (code: DecisionHistoryErrorCode, message: string) => ({
    ok: false as const,
    error: { code, message },
  });
  const createValidated = async (
    ownerUserId: string,
    command: CreateDecisionCommand,
  ): Promise<DecisionHistoryServiceResult<CreateDecisionResult>> => {
    try {
      const data = await repository.createOrGet({
        id: idGenerator.uuid(),
        ownerUserId,
        clientRequestId: command.clientRequestId,
        selected: command.selected,
        candidates: command.candidates,
        source: command.source,
        createdAt: clock.nowSeconds(),
      });
      return { ok: true, data };
    } catch {
      return error("INTERNAL_ERROR", "결정 기록을 저장하지 못했습니다.");
    }
  };

  return {
    async create(ownerUserId, command) {
      const validation = validateAndNormalizeDecision(command);
      if (!validation.ok) {
        return error("INVALID_DECISION_HISTORY", validation.message);
      }
      return createValidated(ownerUserId, validation.command);
    },

    createValidated,

    async list(ownerUserId) {
      try {
        return { ok: true, data: await repository.listByOwner(ownerUserId) };
      } catch {
        return error("INTERNAL_ERROR", "결정 기록을 불러오지 못했습니다.");
      }
    },

    async deleteOne(id, ownerUserId) {
      try {
        const deleted = await repository.deleteByIdAndOwner(id, ownerUserId);
        if (!deleted) {
          return error(
            "DECISION_HISTORY_NOT_FOUND",
            "결정 기록을 찾을 수 없습니다.",
          );
        }
        return { ok: true, data: undefined };
      } catch {
        return error("INTERNAL_ERROR", "결정 기록을 삭제하지 못했습니다.");
      }
    },

    async deleteAll(ownerUserId) {
      try {
        const deletedCount = await repository.deleteAllByOwner(ownerUserId);
        return { ok: true, data: { deletedCount } };
      } catch {
        return error("INTERNAL_ERROR", "결정 기록을 삭제하지 못했습니다.");
      }
    },
  };
}
