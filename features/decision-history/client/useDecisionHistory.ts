"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/client/context.ts";
import type { DecisionHistoryResponse } from "../shared/contract.ts";
import {
  decisionHistoryApiClient,
  type DecisionHistoryApiClient,
} from "./api.ts";

export type DecisionHistoryStatus = "idle" | "loading" | "ready" | "error";

type UseDecisionHistoryOptions = {
  open: boolean;
  refreshToken?: number;
  apiClient?: DecisionHistoryApiClient;
  onLogout?: () => void;
};

export function useDecisionHistory({
  open,
  refreshToken = 0,
  apiClient = decisionHistoryApiClient,
  onLogout,
}: UseDecisionHistoryOptions) {
  const {
    status: authStatus,
    decisionHistoryEnabled,
    onLogoutCleanup,
  } = useAuth();
  const enabled =
    decisionHistoryEnabled && authStatus === "authenticated";
  const [status, setStatus] = useState<DecisionHistoryStatus>("idle");
  const [decisions, setDecisions] = useState<DecisionHistoryResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const mounted = useRef(true);
  const queryEpoch = useRef(0);
  const lifecycleEpoch = useRef(0);
  const mutationEpoch = useRef(0);
  const fetching = useRef(false);
  const mutating = useRef(false);
  const fetchController = useRef<AbortController | null>(null);
  const decisionCount = useRef(0);

  const cancelQuery = useCallback(() => {
    queryEpoch.current += 1;
    fetchController.current?.abort();
    fetchController.current = null;
    fetching.current = false;
  }, []);

  const clear = useCallback(() => {
    lifecycleEpoch.current += 1;
    cancelQuery();
    mutationEpoch.current += 1;
    mutating.current = false;
    decisionCount.current = 0;
    setDecisions([]);
    setError(null);
    setMutationError(null);
    setDeletingId(null);
    setDeletingAll(false);
    setStatus("idle");
  }, [cancelQuery]);

  const runRefresh = useCallback(
    async (replaceInFlight: boolean) => {
      if (!enabled || !open) return false;
      if (fetching.current && !replaceInFlight) return false;
      if (fetching.current) cancelQuery();

      const epoch = ++queryEpoch.current;
      const controller = new AbortController();
      fetchController.current = controller;
      fetching.current = true;
      setError(null);
      if (decisionCount.current === 0) setStatus("loading");

      const result = await apiClient.listDecisions(controller.signal);
      if (
        !mounted.current ||
        epoch !== queryEpoch.current ||
        controller.signal.aborted
      ) {
        return false;
      }

      fetching.current = false;
      fetchController.current = null;
      if (result.ok) {
        decisionCount.current = result.data.decisions.length;
        setDecisions(result.data.decisions);
        setStatus("ready");
        return true;
      }

      if (result.failure === "aborted") {
        setStatus(decisionCount.current === 0 ? "idle" : "ready");
        return false;
      }

      setError(result.error.error.message);
      setStatus(decisionCount.current === 0 ? "error" : "ready");
      return false;
    },
    [apiClient, cancelQuery, enabled, open],
  );

  const refresh = useCallback(() => runRefresh(false), [runRefresh]);

  useEffect(() => {
    mounted.current = true;
    const token = ++lifecycleEpoch.current;
    if (!open || !enabled) {
      cancelQuery();
      return;
    }

    queueMicrotask(() => {
      if (mounted.current && lifecycleEpoch.current === token) {
        void runRefresh(true);
      }
    });

    return () => {
      if (lifecycleEpoch.current === token) lifecycleEpoch.current += 1;
    };
  }, [cancelQuery, enabled, open, refreshToken, runRefresh]);

  useEffect(
    () =>
      onLogoutCleanup(() => {
        clear();
        onLogout?.();
      }),
    [clear, onLogout, onLogoutCleanup],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifecycleEpoch.current += 1;
      mutationEpoch.current += 1;
      cancelQuery();
    };
  }, [cancelQuery]);

  const deleteDecision = useCallback(
    async (id: string) => {
      if (!enabled || mutating.current) return false;
      mutating.current = true;
      const epoch = ++mutationEpoch.current;
      setMutationError(null);
      setDeletingId(id);

      const result = await apiClient.deleteDecision(id);
      if (!mounted.current || epoch !== mutationEpoch.current) return false;

      mutating.current = false;
      setDeletingId(null);
      if (result.ok) {
        const queryWasActive = fetching.current;
        cancelQuery();
        setDecisions((items) => {
          const next = items.filter((item) => item.id !== id);
          decisionCount.current = next.length;
          return next;
        });
        setStatus("ready");
        if (queryWasActive) void runRefresh(true);
        return true;
      }

      if (result.failure !== "aborted") {
        setMutationError(result.error.error.message);
      }
      return false;
    },
    [apiClient, cancelQuery, enabled, runRefresh],
  );

  const deleteAll = useCallback(async () => {
    if (!enabled || mutating.current) return false;
    mutating.current = true;
    const epoch = ++mutationEpoch.current;
    setMutationError(null);
    setDeletingAll(true);

    const result = await apiClient.deleteAllDecisions();
    if (!mounted.current || epoch !== mutationEpoch.current) return false;

    mutating.current = false;
    setDeletingAll(false);
    if (result.ok) {
      const queryWasActive = fetching.current;
      cancelQuery();
      decisionCount.current = 0;
      setDecisions([]);
      setStatus("ready");
      if (queryWasActive) void runRefresh(true);
      return true;
    }

    if (result.failure !== "aborted") {
      setMutationError(result.error.error.message);
    }
    return false;
  }, [apiClient, cancelQuery, enabled, runRefresh]);

  return {
    enabled,
    status,
    decisions,
    error,
    mutationError,
    deletingId,
    deletingAll,
    refresh,
    deleteDecision,
    deleteAll,
    clear,
  };
}
