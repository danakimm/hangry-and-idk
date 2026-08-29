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
};

export type UseMenuSetsReturn = {
  enabled: boolean;
  menuSets: MenuSetResponse[];
  currentMenuSet: MenuSetResponse | null;
  draftName: string;
  draftItems: MenuSetItemRequest[];
  saveStatus: SaveStatus;
  isLoading: boolean;
  error: string | null;
  isMutating: boolean;
  selectMenuSet: (id: string) => boolean;
  createNew: (name: string, items: MenuSetItemRequest[]) => Promise<boolean>;
  updateDraft: (name: string, items: MenuSetItemRequest[]) => void;
  saveCurrent: () => Promise<void>;
  archiveCurrent: () => Promise<boolean>;
  setDefault: () => Promise<boolean>;
  reloadConflict: () => Promise<boolean>;
  resetCurrentDraft: () => void;
  clearError: () => void;
};

function toDraft(menuSet: MenuSetResponse): MenuSetDraft {
  return {
    menuSetId: menuSet.id,
    name: menuSet.name,
    items: menuSet.items.map((item) => ({
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      color: item.color,
    })),
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
  const [isMutating, setIsMutating] = useState(false);

  const menuSetsRef = useRef<MenuSetResponse[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const draftRef = useRef<MenuSetDraft | null>(null);
  const saveStatusRef = useRef<SaveStatus>("idle");
  const mutationRef = useRef(false);
  const generationRef = useRef(0);
  const initializedRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());

  const currentMenuSet = useMemo(
    () => menuSets.find((menuSet) => menuSet.id === currentId) ?? null,
    [menuSets, currentId],
  );

  const setMenuSetState = useCallback((next: MenuSetResponse[]) => {
    menuSetsRef.current = next;
    setMenuSets(next);
  }, []);

  const updateSaveStatus = useCallback((next: SaveStatus) => {
    saveStatusRef.current = next;
    setSaveStatus(next);
  }, []);

  const setCurrent = useCallback((menuSet: MenuSetResponse | null) => {
    currentIdRef.current = menuSet?.id ?? null;
    setCurrentId(menuSet?.id ?? null);
    if (menuSet) {
      const nextDraft = toDraft(menuSet);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    } else {
      draftRef.current = null;
      setDraft(null);
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
    setMenuSetState([]);
    currentIdRef.current = null;
    setCurrentId(null);
    draftRef.current = null;
    setDraft(null);
    updateSaveStatus("idle");
    setIsLoading(false);
    setError(null);
    mutationRef.current = false;
    setIsMutating(false);
    initializedRef.current = false;
  }, [abortRequests, setMenuSetState, updateSaveStatus]);

  const beginMutation = useCallback(() => {
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setIsMutating(true);
    return true;
  }, []);

  const finishMutation = useCallback((generation: number) => {
    if (generation !== generationRef.current) return;
    mutationRef.current = false;
    setIsMutating(false);
  }, []);

  const loadMenuSets = useCallback(async () => {
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
      return result.data.menuSets;
    } finally {
      releaseController(controller);
      if (generation === generationRef.current) setIsLoading(false);
    }
  }, [apiClient, createController, releaseController, setMenuSetState]);

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
    mutationRef.current = false;
    abortRequests();
  }, [abortRequests]);

  const handleSaveFailure = useCallback((
    failure: MenuSetClientFailure,
    message: string,
  ) => {
    if (failure === "aborted") {
      updateSaveStatus("dirty");
      return;
    }
    if (failure === "network") {
      updateSaveStatus("offline");
      return;
    }
    updateSaveStatus("dirty");
    setError(message);
  }, [updateSaveStatus]);

  const handleOperationFailure = useCallback((
    failure: MenuSetClientFailure,
    message: string,
  ) => {
    if (failure !== "aborted") setError(message);
  }, []);

  const selectMenuSet = useCallback((id: string) => {
    if (mutationRef.current) return false;
    const selected = menuSetsRef.current.find((menuSet) => menuSet.id === id);
    if (!selected) return false;
    setCurrent(selected);
    updateSaveStatus("idle");
    setError(null);
    return true;
  }, [setCurrent, updateSaveStatus]);

  const createNew = useCallback(async (
    name: string,
    items: MenuSetItemRequest[],
  ): Promise<boolean> => {
    if (!enabled || !beginMutation()) return false;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    try {
      const result = await apiClient.createMenuSet({ name, items }, controller.signal);
      if (generation !== generationRef.current) return false;
      if (!result.ok) {
        handleOperationFailure(result.failure, result.error.error.message);
        return false;
      }
      const next = [result.data, ...menuSetsRef.current];
      setMenuSetState(next);
      setCurrent(result.data);
      updateSaveStatus("saved");
      return true;
    } finally {
      releaseController(controller);
      finishMutation(generation);
    }
  }, [
    apiClient,
    beginMutation,
    createController,
    enabled,
    finishMutation,
    handleOperationFailure,
    releaseController,
    setCurrent,
    setMenuSetState,
    updateSaveStatus,
  ]);

  const updateDraft = useCallback((name: string, items: MenuSetItemRequest[]) => {
    const menuSetId = currentIdRef.current;
    if (!menuSetId) return;
    if (mutationRef.current || saveStatusRef.current === "conflict") return;
    const next: MenuSetDraft = {
      menuSetId,
      name,
      items,
    };
    draftRef.current = next;
    setDraft(next);
    updateSaveStatus("dirty");
    setError(null);
  }, [updateSaveStatus]);

  const resetCurrentDraft = useCallback(() => {
    if (mutationRef.current) return;
    const menuSetId = currentIdRef.current;
    if (!menuSetId) return;
    const serverMenuSet = menuSetsRef.current.find((menuSet) => menuSet.id === menuSetId);
    if (!serverMenuSet) return;
    const nextDraft = toDraft(serverMenuSet);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    updateSaveStatus("idle");
    setError(null);
  }, [updateSaveStatus]);

  const saveCurrent = useCallback(async () => {
    const candidate = draftRef.current;
    if (!candidate) return;
    if (saveStatusRef.current !== "dirty" && saveStatusRef.current !== "offline") return;
    if (!beginMutation()) return;

    const serverMenuSet = menuSetsRef.current.find(
      (menuSet) => menuSet.id === candidate.menuSetId,
    );
    if (!serverMenuSet) {
      finishMutation(generationRef.current);
      return;
    }

    const generation = generationRef.current;
    const controller = createController();
    updateSaveStatus("saving");
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
        if (result.error.error.code === "MENU_SET_VERSION_CONFLICT") {
          updateSaveStatus("conflict");
          return;
        }
        handleSaveFailure(result.failure, result.error.error.message);
        return;
      }

      const nextList = replaceMenuSet(menuSetsRef.current, result.data);
      setMenuSetState(nextList);

      const normalizedDraft = toDraft(result.data);
      draftRef.current = normalizedDraft;
      setDraft(normalizedDraft);
      updateSaveStatus("saved");
    } finally {
      releaseController(controller);
      finishMutation(generation);
    }
  }, [
    apiClient,
    beginMutation,
    createController,
    finishMutation,
    handleSaveFailure,
    releaseController,
    setMenuSetState,
    updateSaveStatus,
  ]);

  const archiveCurrent = useCallback(async (): Promise<boolean> => {
    const menuSetId = currentIdRef.current;
    const serverMenuSet = menuSetsRef.current.find((menuSet) => menuSet.id === menuSetId);
    if (!enabled || !menuSetId || !serverMenuSet || !beginMutation()) return false;
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
        handleOperationFailure(result.failure, result.error.error.message);
        return false;
      }
      setMenuSetState(menuSetsRef.current.filter((menuSet) => menuSet.id !== menuSetId));
      setCurrent(null);
      updateSaveStatus("idle");
      await loadMenuSets();
      return true;
    } finally {
      releaseController(controller);
      finishMutation(generation);
    }
  }, [
    apiClient,
    beginMutation,
    createController,
    enabled,
    finishMutation,
    handleOperationFailure,
    loadMenuSets,
    releaseController,
    setCurrent,
    setMenuSetState,
    updateSaveStatus,
  ]);

  const setDefault = useCallback(async (): Promise<boolean> => {
    const menuSetId = currentIdRef.current;
    if (!enabled || !menuSetId || !beginMutation()) return false;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    try {
      const result = await apiClient.setDefaultMenuSet(menuSetId, controller.signal);
      if (generation !== generationRef.current) return false;
      if (!result.ok) {
        handleOperationFailure(result.failure, result.error.error.message);
        return false;
      }
      setMenuSetState(menuSetsRef.current.map((menuSet) => {
        if (menuSet.id === menuSetId) return result.data;
        return menuSet.isDefault ? { ...menuSet, isDefault: false } : menuSet;
      }));
      await loadMenuSets();
      return true;
    } finally {
      releaseController(controller);
      finishMutation(generation);
    }
  }, [
    apiClient,
    beginMutation,
    createController,
    enabled,
    finishMutation,
    handleOperationFailure,
    loadMenuSets,
    releaseController,
    setMenuSetState,
  ]);

  const reloadConflict = useCallback(async (): Promise<boolean> => {
    const menuSetId = currentIdRef.current;
    if (!menuSetId || !beginMutation()) return false;
    const generation = generationRef.current;
    const controller = createController();
    setError(null);
    try {
      const result = await apiClient.fetchMenuSet(menuSetId, controller.signal);
      if (generation !== generationRef.current) return false;
      if (!result.ok) {
        handleOperationFailure(result.failure, result.error.error.message);
        return false;
      }
      setMenuSetState(replaceMenuSet(menuSetsRef.current, result.data));
      setCurrent(result.data);
      updateSaveStatus("idle");
      return true;
    } finally {
      releaseController(controller);
      finishMutation(generation);
    }
  }, [
    apiClient,
    beginMutation,
    createController,
    finishMutation,
    handleOperationFailure,
    releaseController,
    setCurrent,
    setMenuSetState,
    updateSaveStatus,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return {
    enabled,
    menuSets,
    currentMenuSet,
    draftName: draft?.name ?? "",
    draftItems: draft?.items ?? [],
    saveStatus,
    isLoading,
    error,
    isMutating,
    selectMenuSet,
    createNew,
    updateDraft,
    saveCurrent,
    archiveCurrent,
    setDefault,
    reloadConflict,
    resetCurrentDraft,
    clearError,
  };
}
