import type {
  MenuSetAggregate,
  MenuSetItemRecord,
} from "./model.server.ts";
import type {
  MenuSetResponse,
  MenuSetItemResponse,
  MenuSetListResponse,
} from "../shared/contract.ts";

export function mapItemToResponse(item: MenuSetItemRecord): MenuSetItemResponse {
  return {
    id: item.id,
    name: item.name,
    emoji: item.emoji,
    color: item.color,
  };
}

export function mapMenuSetToResponse(
  aggregate: MenuSetAggregate,
): MenuSetResponse {
  return {
    id: aggregate.menuSet.id,
    name: aggregate.menuSet.name,
    version: aggregate.menuSet.version,
    isDefault: aggregate.menuSet.isDefault,
    createdAt: aggregate.menuSet.createdAt,
    updatedAt: aggregate.menuSet.updatedAt,
    items: aggregate.items
      .sort((a, b) => a.position - b.position)
      .map(mapItemToResponse),
  };
}

export function mapMenuSetListToResponse(
  aggregates: MenuSetAggregate[],
): MenuSetListResponse {
  return {
    menuSets: aggregates.map(mapMenuSetToResponse),
  };
}
