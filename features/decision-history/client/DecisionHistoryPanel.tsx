"use client";

import { useCallback, useRef, useState } from "react";
import DecisionHistoryDrawer from "./DecisionHistoryDrawer.tsx";
import DecisionHistoryTrigger from "./DecisionHistoryTrigger.tsx";
import { useDecisionHistory } from "./useDecisionHistory.ts";
import type { DecisionHistoryApiClient } from "./api.ts";

type Props = { refreshToken?: number; apiClient?: DecisionHistoryApiClient };

export default function DecisionHistoryPanel({ refreshToken = 0, apiClient }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const history = useDecisionHistory({ open, refreshToken, onLogout: close, apiClient });

  return (
    <>
      <DecisionHistoryTrigger
        onOpen={() => setOpen(true)}
        open={open}
        buttonRef={triggerRef}
      />
      <DecisionHistoryDrawer
        open={open}
        decisions={history.decisions}
        status={history.status}
        error={history.error}
        mutationError={history.mutationError}
        deletingId={history.deletingId}
        deletingAll={history.deletingAll}
        onClose={close}
        onRetry={() => void history.refresh()}
        onDelete={history.deleteDecision}
        onDeleteAll={history.deleteAll}
        triggerRef={triggerRef}
      />
    </>
  );
}
