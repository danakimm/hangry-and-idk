import type { MenuSetRepository } from "./ports.server.ts";
import type {
  MenuSetAggregate,
  CreateMenuSetCommand,
  UpdateMenuSetCommand,
  ArchiveMenuSetCommand,
} from "./model.server.ts";
import type { IdGenerator, Clock } from "../../../server/db/types.server.ts";
import {
  normalizeName,
  validateMenuSetName,
  validateItems,
  validateColor,
  validateEmoji,
  validateVersion,
  MENU_SET_MAX_ACTIVE,
} from "./validation.server.ts";

export type MenuSetErrorCode =
  | "MENU_SET_NOT_FOUND"
  | "MENU_SET_LIMIT_REACHED"
  | "MENU_SET_VERSION_CONFLICT"
  | "DUPLICATE_MENU_NAME"
  | "INVALID_MENU_SET"
  | "INTERNAL_ERROR";

export type MenuSetServiceError = {
  code: MenuSetErrorCode;
  message: string;
};

export type MenuSetServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MenuSetServiceError };

export type MenuSetService = {
  list(ownerUserId: string): Promise<MenuSetServiceResult<MenuSetAggregate[]>>;
  get(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetServiceResult<MenuSetAggregate>>;
  create(
    ownerUserId: string,
    command: CreateMenuSetCommand,
  ): Promise<MenuSetServiceResult<MenuSetAggregate>>;
  update(
    menuSetId: string,
    ownerUserId: string,
    command: UpdateMenuSetCommand,
  ): Promise<MenuSetServiceResult<MenuSetAggregate>>;
  archive(
    menuSetId: string,
    ownerUserId: string,
    command: ArchiveMenuSetCommand,
  ): Promise<MenuSetServiceResult<void>>;
  setDefault(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetServiceResult<MenuSetAggregate>>;
};

export type MenuSetServiceDependencies = {
  repository: MenuSetRepository;
  idGenerator: IdGenerator;
  clock: Clock;
};

export function createMenuSetService(
  deps: MenuSetServiceDependencies,
): MenuSetService {
  const { repository, idGenerator, clock } = deps;

  function makeError(
    code: MenuSetErrorCode,
    message: string,
  ): MenuSetServiceError {
    return { code, message };
  }

  async function ensureOwnership(
    menuSetId: string,
    ownerUserId: string,
  ): Promise<MenuSetServiceResult<MenuSetAggregate>> {
    const aggregate = await repository.findByIdAndOwner(menuSetId, ownerUserId);
    if (!aggregate || aggregate.menuSet.archivedAt !== null) {
      return {
        ok: false,
        error: makeError("MENU_SET_NOT_FOUND", "메뉴판을 찾을 수 없습니다."),
      };
    }
    return { ok: true, data: aggregate };
  }

  return {
    async list(
      ownerUserId: string,
    ): Promise<MenuSetServiceResult<MenuSetAggregate[]>> {
      const aggregates = await repository.listByOwner(ownerUserId);
      return { ok: true, data: aggregates };
    },

    async get(
      menuSetId: string,
      ownerUserId: string,
    ): Promise<MenuSetServiceResult<MenuSetAggregate>> {
      return ensureOwnership(menuSetId, ownerUserId);
    },

    async create(
      ownerUserId: string,
      command: CreateMenuSetCommand,
    ): Promise<MenuSetServiceResult<MenuSetAggregate>> {
      const nameError = validateMenuSetName(command.name);
      if (nameError) {
        return { ok: false, error: makeError("INVALID_MENU_SET", nameError.message) };
      }

      const itemsError = validateItems(command.items);
      if (itemsError) {
        return { ok: false, error: makeError("INVALID_MENU_SET", itemsError.message) };
      }

      for (const item of command.items) {
        if (!validateColor(item.color)) {
          return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 색상 형식입니다.") };
        }
        if (!validateEmoji(item.emoji)) {
          return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 이모지 형식입니다.") };
        }
      }

      const activeCount = await repository.countActiveByOwner(ownerUserId);
      if (activeCount >= MENU_SET_MAX_ACTIVE) {
        return {
          ok: false,
          error: makeError(
            "MENU_SET_LIMIT_REACHED",
            `메뉴판은 최대 ${MENU_SET_MAX_ACTIVE}개까지 만들 수 있습니다.`,
          ),
        };
      }

      const now = clock.nowSeconds();
      const menuSetId = idGenerator.uuid();
      const normalizedName = normalizeName(command.name);
      const isFirst = activeCount === 0;

      const itemRecords = command.items.map((item, index) => ({
        id: idGenerator.uuid(),
        name: normalizeName(item.name),
        normalizedName: normalizeName(item.name).toLowerCase(),
        emoji: item.emoji,
        color: item.color,
        position: index,
      }));

      try {
        await repository.create({
          id: menuSetId,
          ownerUserId,
          name: normalizedName,
          version: 1,
          isDefault: isFirst,
          createdAt: now,
          updatedAt: now,
          items: itemRecords,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("MENU_SET_LIMIT_REACHED") || message.includes("제한")) {
          return {
            ok: false,
            error: makeError("MENU_SET_LIMIT_REACHED", `메뉴판은 최대 ${MENU_SET_MAX_ACTIVE}개까지 만들 수 있습니다.`),
          };
        }
        if (message.includes("중복") || message.includes("UNIQUE")) {
          return {
            ok: false,
            error: makeError("DUPLICATE_MENU_NAME", "같은 이름의 메뉴판이 이미 존재합니다."),
          };
        }
        return { ok: false, error: makeError("INTERNAL_ERROR", "메뉴판 생성에 실패했습니다.") };
      }

      const aggregate = await repository.findByIdAndOwner(menuSetId, ownerUserId);
      if (!aggregate) {
        return { ok: false, error: makeError("INTERNAL_ERROR", "메뉴판 생성에 실패했습니다.") };
      }

      return { ok: true, data: aggregate };
    },

    async update(
      menuSetId: string,
      ownerUserId: string,
      command: UpdateMenuSetCommand,
    ): Promise<MenuSetServiceResult<MenuSetAggregate>> {
      if (!validateVersion(command.version)) {
        return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 version입니다.") };
      }

      const ownership = await ensureOwnership(menuSetId, ownerUserId);
      if (!ownership.ok) return ownership;

      const nameError = validateMenuSetName(command.name);
      if (nameError) {
        return { ok: false, error: makeError("INVALID_MENU_SET", nameError.message) };
      }

      const itemsError = validateItems(command.items);
      if (itemsError) {
        return { ok: false, error: makeError("INVALID_MENU_SET", itemsError.message) };
      }

      for (const item of command.items) {
        if (!validateColor(item.color)) {
          return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 색상 형식입니다.") };
        }
        if (!validateEmoji(item.emoji)) {
          return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 이모지 형식입니다.") };
        }
      }

      const current = ownership.data.menuSet;
      if (current.version !== command.version) {
        return {
          ok: false,
          error: makeError("MENU_SET_VERSION_CONFLICT", "다른 곳에서 메뉴판이 변경되었습니다."),
        };
      }

      const existingItems = ownership.data.items;
      const existingIdSet = new Set(existingItems.map((i) => i.id));

      for (const item of command.items) {
        if (item.id !== null && item.id !== undefined && item.id !== "") {
          if (!existingIdSet.has(item.id)) {
            return { ok: false, error: makeError("INVALID_MENU_SET", "존재하지 않는 메뉴 항목입니다.") };
          }
        }
      }

      const seenIds = new Set<string>();
      for (const item of command.items) {
        if (item.id !== null && item.id !== undefined && item.id !== "") {
          if (seenIds.has(item.id)) {
            return { ok: false, error: makeError("INVALID_MENU_SET", "중복된 메뉴 항목 ID입니다.") };
          }
          seenIds.add(item.id);
        }
      }

      const now = clock.nowSeconds();
      const normalizedName = normalizeName(command.name);

      const result = await repository.updateAggregate(
        menuSetId,
        ownerUserId,
        command.version,
        {
          name: normalizedName,
          items: command.items.map((item, index) => ({
            id: item.id ?? null,
            name: normalizeName(item.name),
            normalizedName: normalizeName(item.name).toLowerCase(),
            emoji: item.emoji,
            color: item.color,
            position: index,
          })),
        },
        now,
      );

      if (result.status === "versionConflict") {
        return {
          ok: false,
          error: makeError("MENU_SET_VERSION_CONFLICT", "다른 곳에서 메뉴판이 변경되었습니다."),
        };
      }
      if (result.status === "notFound") {
        return { ok: false, error: makeError("MENU_SET_NOT_FOUND", "메뉴판을 찾을 수 없습니다.") };
      }

      return { ok: true, data: result.aggregate };
    },

    async archive(
      menuSetId: string,
      ownerUserId: string,
      command: ArchiveMenuSetCommand,
    ): Promise<MenuSetServiceResult<void>> {
      if (!validateVersion(command.version)) {
        return { ok: false, error: makeError("INVALID_MENU_SET", "올바르지 않은 version입니다.") };
      }

      const ownership = await ensureOwnership(menuSetId, ownerUserId);
      if (!ownership.ok) return ownership;

      const current = ownership.data.menuSet;
      if (current.version !== command.version) {
        return {
          ok: false,
          error: makeError("MENU_SET_VERSION_CONFLICT", "다른 곳에서 메뉴판이 변경되었습니다."),
        };
      }

      const now = clock.nowSeconds();
      const result = await repository.archiveWithFallback(
        menuSetId,
        ownerUserId,
        command.version,
        now,
      );

      if (result.status === "versionConflict") {
        return {
          ok: false,
          error: makeError("MENU_SET_VERSION_CONFLICT", "다른 곳에서 메뉴판이 변경되었습니다."),
        };
      }
      if (result.status === "notFound") {
        return { ok: false, error: makeError("MENU_SET_NOT_FOUND", "메뉴판을 찾을 수 없습니다.") };
      }

      return { ok: true, data: undefined };
    },

    async setDefault(
      menuSetId: string,
      ownerUserId: string,
    ): Promise<MenuSetServiceResult<MenuSetAggregate>> {
      const ownership = await ensureOwnership(menuSetId, ownerUserId);
      if (!ownership.ok) return ownership;

      const result = await repository.setDefault(menuSetId, ownerUserId);
      if (result.status === "notFound") {
        return { ok: false, error: makeError("MENU_SET_NOT_FOUND", "메뉴판을 찾을 수 없습니다.") };
      }
      if (result.status === "versionConflict") {
        return {
          ok: false,
          error: makeError(
            "MENU_SET_VERSION_CONFLICT",
            "다른 곳에서 메뉴판이 변경되었습니다.",
          ),
        };
      }

      const aggregate = await repository.findByIdAndOwner(menuSetId, ownerUserId);
      if (!aggregate) {
        return { ok: false, error: makeError("INTERNAL_ERROR", "기본 메뉴판 설정에 실패했습니다.") };
      }

      return { ok: true, data: aggregate };
    },
  };
}
