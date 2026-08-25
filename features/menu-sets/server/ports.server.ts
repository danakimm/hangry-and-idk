import type {
  MenuSetAggregate,
  UpdateAggregateInput,
  AggregateWriteResult,
} from "./model.server.ts";

export type MenuSetRepository = {
  listByOwner(ownerUserId: string): Promise<MenuSetAggregate[]>;
  findByIdAndOwner(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetAggregate | null>;
  countActiveByOwner(ownerUserId: string): Promise<number>;
  create(data: {
    id: string;
    ownerUserId: string;
    name: string;
    version: number;
    isDefault: boolean;
    createdAt: number;
    updatedAt: number;
    items: {
      id: string;
      name: string;
      normalizedName: string;
      emoji: string;
      color: string;
      position: number;
    }[];
  }): Promise<void>;
  updateAggregate(
    menuSetId: string,
    ownerUserId: string,
    currentVersion: number,
    input: UpdateAggregateInput,
    updatedAt: number,
  ): Promise<AggregateWriteResult>;
  archiveWithFallback(
    menuSetId: string,
    ownerUserId: string,
    currentVersion: number,
    archivedAt: number,
  ): Promise<
    | { status: "archived"; fallbackDefaultId: string | null }
    | { status: "notFound" }
    | { status: "versionConflict" }
  >;
  setDefault(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<{ status: "updated" | "notFound" | "versionConflict" }>;
};
