"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MenuSetResponse, MenuSetItemRequest } from "../shared/contract.ts";
import {
  menuSetApiClient,
  type MenuSetApiClient,
  type MenuSetClientFailure,
} from "./api.ts";
import { useAuth } from "../../auth/client/context.ts";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "offline";

type MenuSetDraft = {
  menuSetId: string;
  name: string;
  items: MenuSetItemRequest[];
  revision: number;
};

type PendingSave = MenuSetDraft;

export type UseMenuSetsReturn = {
  enabled: boolean;
  menuSets: MenuSetResponse[];
  currentMenuSet: MenuSetResponse | null;
  draftName: string;
  draftItems: MenuSetItemRequest[];
  saveStatus: SaveStatus;
  isLoading: boolean;
  error: string | null;
  selectMenuSet: (id: string) => boolean;
  createNew: (name: string, items: MenuSetItemRequest[]) => Promise<boolean>;
  updateDraft: (name: string, items: MenuSetItemRequest[]) => void;
  saveCurrent: () => Promise<void>;
  archiveCurrent: () => Promise<boolean>;
  setDefault: () => Promise<void>;
  reloadConflict: () => Promise<void>;
  saveConflictAsNew: (name: string) => Promise<boolean>;
  clearError: () => void;
  retryLastSave: () => void;
};

const DEBOUNCE_MS = 700;
const SAVED_STATUS_MS = 2000;
const LOCAL_STORAGE_KEY = "menu-set-selected-id";

function toDraft(menuSet: MenuSetResponse, revision: number): MenuSetDraft {
  return {
    menuSetId: menuSet.id,
    name: menuSet.name,
    items: menuSet.items.map((item) => ({
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      color: item.color,
    })),
    revision,
  };
}

function replaceMenuSet(
  menuSets: MenuSetResponse[],
  replacement: MenuSetResponse,
): MenuSetResponse[] {
  return menuSets.map((menuSet) =>
    menuSet.id === replacement.id ? replacement : menuSet
  );
}

export function useMenuSets(
  apiClient: MenuSetApiClient = menuSetApiClient,
): UseMenuSetsReturn {
  const { status, menuSetsEnabled, onLogoutCleanup } = useAuth();
  const enabled = menuSetsEnabled && status === "authenticated";

  const [menuSets, setMenuSets] = useState<MenuSetResponse[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MenuSetDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const menuSetsRef = useRef<MenuSetResponse[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const draftRef = useRef<MenuSetDraft | null>(null);
  const revisionRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedStatusRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const lastFailedSaveRef = useRef<PendingSave | null>(null);
  const generationRef = useRef(0);
  const initializedRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const persistRef = useRef<(candidate: PendingSave) => Promise<void>>(async () => {});

  const currentMenuSet = useMemo(
    () => menuSets.find((menuSet) => menuSet.id === currentId) ?? null,
    [menuSets, currentId],
  );

  const setMenuSetState = useCallback((next: MenuSetResponse[]) => {
    menuSetsRef.current = next;
    setMenuSets(next);
  }, []);

  const setCurrent = useCallback((menuSet: MenuSetResponse | null) => {
    currentIdRef.current = menuSet?.id ?? null;
    setCurrentId(menuSet?.id ?? null);
    if (menuSet) {
      const nextDraft = toDraft(menuSet, ++revisionRef.current);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      localStorage.setItem(LOCAL_STORAGE_KEY, menuSet.id);
    } else {
      draftRef.current = null;
      setDraft(null);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (savedStatusRef.current) {
      clearTimeout(savedStatusRef.current);
      savedStatusRef.current = null;
    }
  }, []);

  const abortRequests = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
  }, []);

  const createController = useCallback(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);

  const releaseController = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller);
  }, []);

  const resetUserState = useCallback(() => {
    generationRef.current += 1;
    abortRequests();
    clearTimers();
    setMenuSetState([]);
    currentIdRef.current = null;
    setCurrentId(null);
    draftRef.current = null;
    setDraft(null);
    setSaveStatus("idle");
    setIsLoading(false);
    setError(null);
    savingRef.current = false;
    pendingSaveRef.current = null;
    lastFailedSaveRef.current = null;
    initializedRef.current = false;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }, [abortRequests, clearTimers, setMenuSetState]);

  const markSaved = useCallback(() => {
    setSaveStatus("saved");
    if (savedStatusRef.current) clearTimeout(savedStatusRef.current);
    const generation = generationRef.current;
    savedStatusRef.current = setTimeout(() => {
      savedStatusRef.current = null;
      if (generation === generationRef.current) {
        setSaveStatus((previous) => previous === "saved" ? "idle" : previous);
      }
    }, SAVED_STATUS_MS);
  }, []);

  const selectFromList = useCallback((list: MenuSetResponse[], preferredId?: string | null) => {
    const selected = (
      preferredId
        ? list.find((menuSet) => menuSet.id === preferredId)
        : undefined
    ) ?? list.find((menuSet) => menuSet.isDefault) ?? list[0] ?? null;
    setCurrent(selected);
    return selected;
  }, [setCurrent]);

  const loadMenuSets = useCallback(async (preferredId?: string | null) => {
    const generation = generationRef.current;
    const controller = createController();
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiClient.fetchMenuSets(controller.signal);
      if (generation !== generationRef.current || result.ok === false && result.failure === "aborted") {
        return null;
      }
      if (!result.ok) {
        setError(result.error.error.message);
        return null;
      }
      setMenuSetState(result.data.menuSets);
      const storedId = preferredId ?? localStorage.getItem(LOCAL_STORAGE_KEY);
      return selectFromList(result.data.menuSets, storedId);
    } finally {
      releaseController(controller);
      if (generation === generationRef.current) setIsLoading(false);
    }
  }, [apiClient, createController, releaseController, selectFromList, setMenuSetState]);

  useEffect(() => {
    if (!enabled) {
      resetUserState(); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    void loadMenuSets();
  }, [enabled, loadMenuSets, resetUserState]);

  useEffect(() => onLogoutCleanup(resetUserState), [onLogoutCleanup, resetUserState]);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRequests();
    clearTimers();
  }, [abortRequests, clearTimers]);

  const handleFailure = useCallback((
    failure: MenuSetClientFailure,
    message: string,
    failedSave?: PendingSave,
  ) => {
    savingRef.current = false;
    if (failure === "aborted") return;
    if (failure === "network") {
      if (failedSave) lastFailedSaveRef.current = failedSave;
      setSaveStatus("offline");
      return;
    }
    setSaveStatus("idle");
    setError(message);
  }, []);

  const persist = useCallback(async (candidate: PendingSave) => {
    if (!enabled) return;
    if (savingRef.current) {
      pendingSaveRef.current = candidate;
      return;
    }

    const serverMenuSet = menuSetsRef.current.find(
      (menuSet) => menuSet.id === candidate.menuSetId,
    );
    if (!serverMenuSet) return;

    const generation = generationRef.current;
    const controller = createController();
    savingRef.current = true;
    setSaveStatus("saving");
    setError(null);

    try {
      const result = await apiClient.updateMenuSet(
        candidate.menuSetId,
        {
          version: serverMenuSet.version,
          name: candidate.name,
          items: candidate.items,
        },
        controller.signal,
      );
      if (generation !== generationRef.current) return;

      if (!result.ok) {
        savingRef.current = false;
        if (result.failure === "aborted") return;
        if (result.error.error.code === "MENU_SET_VERSION_CONFLICT") {
          lastFailedSaveRef.current = candidate;
          pendingSaveRef.current = null;
          setSaveStatus("conflict");
          return;
        }
        handleFailure(result.failure, result.error.error.message, candidate);
        return;
      }

      const nextList = replaceMenuSet(menuSetsRef.current, result.data);
      setMenuSetState(nextList);
      lastFailedSaveRef.current = null;
      savingRef.current = false;

      if (
        draftRef.current?.menuSetId === result.data.id &&
        draftRef.current.revision === candidate.revision
      ) {
        const normalizedDraft = toDraft(result.data, candidate.revision);
        draftRef.current = normalizedDraft;
        setDraft(normalizedDraft);
      }

      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) {
        await persistRef.current(pending);
      } else {
        markSaved();
      }
    } finally {
      releaseController(controller);
    }
  }, [
    apiClient,
    createController,
    enabled,
    handleFailure,
    markSaved,
    releaseController,
    setMenuSetState,
  ]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const selectMenuSet = useCallback((id: string) => {
    const selected = menuSetsRef.current.find((menuSet) => menuSet.id === id);
    if (!selected) return false;
    clearTimers();
    pendingSaveRef.current = null;
    lastFailedSaveRef.current = null;
    setCurrent(selected);
    setSaveStatus("idle");
    setError(null);
    return true;
  }, [clearTimers, setCurrent]);

  const createNew = useCallback(async (
    name: string,
    items: MenuSetItemRequest[],
  ): Promise<boolean> => {
    if (!enabled) return false;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    setSaveStatus("saving");
    try {
      const result = await apiClient.createMenuSet({ name, items }, controller.signal);
      if (generation !== generationRef.current) return false;
      if (!result.ok) {
        handleFailure(result.failure, result.error.error.message);
        return false;
      }
      const next = [result.data, ...menuSetsRef.current];
      setMenuSetState(next);
      setCurrent(result.data);
      markSaved();
      return true;
    } finally {
      releaseController(controller);
    }
  }, [
    apiClient,
    createController,
    enabled,
    handleFailure,
    markSaved,
    releaseController,
    setCurrent,
    setMenuSetState,
  ]);

  const updateDraft = useCallback((name: string, items: MenuSetItemRequest[]) => {
    const menuSetId = currentIdRef.current;
    if (!menuSetId) return;
    const next: MenuSetDraft = {
      menuSetId,
      name,
      items,
      revision: ++revisionRef.current,
    };
    draftRef.current = next;
    setDraft(next);
    setSaveStatus("dirty");
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void persistRef.current(next);
    }, DEBOUNCE_MS);
  }, []);

  const saveCurrent = useCallback(async () => {
    const candidate = draftRef.current;
    if (!candidate) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await persist(candidate);
  }, [persist]);

  const archiveCurrent = useCallback(async (): Promise<boolean> => {
    const menuSetId = currentIdRef.current;
    const serverMenuSet = menuSetsRef.current.find((menuSet) => menuSet.id === menuSetId);
    if (!enabled || !menuSetId || !serverMenuSet) return false;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    try {
      const result = await apiClient.deleteMenuSet(
        menuSetId,
        { version: serverMenuSet.version },
        controller.signal,
      );
      if (generation !== generationRef.current) return false;
      if (!result.ok) {
        handleFailure(result.failure, result.error.error.message);
        return false;
      }
      await loadMenuSets();
      setSaveStatus("idle");
      return true;
    } finally {
      releaseController(controller);
    }
  }, [
    apiClient,
    createController,
    enabled,
    handleFailure,
    loadMenuSets,
    releaseController,
  ]);

  const setDefault = useCallback(async () => {
    const menuSetId = currentIdRef.current;
    if (!enabled || !menuSetId) return;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    try {
      const result = await apiClient.setDefaultMenuSet(menuSetId, controller.signal);
      if (generation !== generationRef.current) return;
      if (!result.ok) {
        handleFailure(result.failure, result.error.error.message);
        return;
      }
      await loadMenuSets(menuSetId);
    } finally {
      releaseController(controller);
    }
  }, [
    apiClient,
    createController,
    enabled,
    handleFailure,
    loadMenuSets,
    releaseController,
  ]);

  const reloadConflict = useCallback(async () => {
    const menuSetId = currentIdRef.current;
    if (!menuSetId) return;
    const generation = generationRef.current;
    const controller = createController();
    try {
      const result = await apiClient.fetchMenuSet(menuSetId, controller.signal);
      if (generation !== generationRef.current) return;
      if (!result.ok) {
        handleFailure(result.failure, result.error.error.message);
        return;
      }
      setMenuSetState(replaceMenuSet(menuSetsRef.current, result.data));
      setCurrent(result.data);
      pendingSaveRef.current = null;
      lastFailedSaveRef.current = null;
      setSaveStatus("idle");
    } finally {
      releaseController(controller);
    }
  }, [
    apiClient,
    createController,
    handleFailure,
    releaseController,
    setCurrent,
    setMenuSetState,
  ]);

  const saveConflictAsNew = useCallback(async (name: string) => {
    const failed = lastFailedSaveRef.current;
    if (!failed) return false;
    const created = await createNew(name, failed.items.map((item) => ({
      ...item,
      id: null,
    })));
    if (created) {
      lastFailedSaveRef.current = null;
      pendingSaveRef.current = null;
    }
    return created;
  }, [createNew]);

  const retryLastSave = useCallback(() => {
    const failed = lastFailedSaveRef.current;
    if (!failed) return;
    lastFailedSaveRef.current = null;
    void persist(failed);
  }, [persist]);

  const clearError = useCallback(() => setError(null), []);

  return {
    enabled: menuSetsEnabled,
    menuSets,
    currentMenuSet,
    draftName: draft?.name ?? "",
    draftItems: draft?.items ?? [],
    saveStatus,
    isLoading,
    error,
    selectMenuSet,
    createNew,
    updateDraft,
    saveCurrent,
    archiveCurrent,
    setDefault,
    reloadConflict,
    saveConflictAsNew,
    clearError,
    retryLastSave,
  };
}
