export type MenuSetRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  version: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

export type MenuSetItemRecord = {
  id: string;
  menuSetId: string;
  name: string;
  normalizedName: string;
  emoji: string;
  color: string;
  position: number;
};

export type MenuSetAggregate = {
  menuSet: MenuSetRecord;
  items: MenuSetItemRecord[];
};

export type UpdateAggregateInput = {
  name: string;
  items: {
    id: string | null;
    name: string;
    normalizedName: string;
    emoji: string;
    color: string;
    position: number;
  }[];
};

export type AggregateWriteResult =
  | { status: "updated"; aggregate: MenuSetAggregate }
  | { status: "notFound" }
  | { status: "versionConflict" };

export type CreateMenuSetCommand = {
  name: string;
  items: {
    id: string | null;
    name: string;
    emoji: string;
    color: string;
  }[];
};

export type UpdateMenuSetCommand = {
  version: number;
  name: string;
  items: {
    id: string | null;
    name: string;
    emoji: string;
    color: string;
  }[];
};

export type ArchiveMenuSetCommand = {
  version: number;
};
