"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/client/context.ts";
import {
  decisionHistoryApiClient,
  type DecisionHistoryCreateApiClient,
} from "./api.ts";
import type { DecisionDraft } from "./decision-draft.ts";

export type DecisionRecorderStatus = "idle" | "saving" | "saved" | "error";
export function useDecisionRecorder(
  draft: DecisionDraft | null,
  apiClient: DecisionHistoryCreateApiClient = decisionHistoryApiClient,
) {
  const {
    status: authStatus,
    decisionHistoryEnabled,
    onLogoutCleanup,
  } = useAuth();
  const enabled = decisionHistoryEnabled && authStatus === "authenticated";
  const [status, setStatus] = useState<DecisionRecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const statusRef = useRef<DecisionRecorderStatus>("idle");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const changeStatus = useCallback((next: DecisionRecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const reset = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setError(null);
    changeStatus("idle");
  }, [changeStatus]);
  useEffect(() => {
    if (draftRef.current !== draft) {
      draftRef.current = draft;
      reset();
    }
  }, [draft, reset]);
  useEffect(() => onLogoutCleanup(reset), [onLogoutCleanup, reset]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const save = useCallback(async () => {
    const current = draftRef.current;
    if (
      !enabled ||
      !current ||
      statusRef.current === "saving" ||
      statusRef.current === "saved"
    )
      return false;
    const requestGeneration = ++generation.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setError(null);
    changeStatus("saving");
    const result = await apiClient.createDecision(
      current,
      nextController.signal,
    );
    if (
      requestGeneration !== generation.current ||
      nextController.signal.aborted
    )
      return false;
    controller.current = null;
    if (result.ok) {
      changeStatus("saved");
      return true;
    }
    if (result.failure === "aborted") {
      changeStatus("idle");
      return false;
    }
    setError(result.error.error.message);
    changeStatus("error");
    return false;
  }, [apiClient, changeStatus, enabled]);
  return { enabled, status, error, save, reset };
}
