import type { ScheduleModalOpenResetPlan } from "./modalOpenResetPlan";

type ModalOpenPlanSetters<SessionLike> = {
  setRetryHint: (value: string | null) => void;
  setPendingAgentIdempotencyKey: (value: string | null) => void;
  setPendingAgentOperationId: (value: string | null) => void;
  setPendingTraceRequestId: (value: string | null) => void;
  setPendingTraceCorrelationId: (value: string | null) => void;
  setSelectedSession: (value: SessionLike | undefined) => void;
  setSelectedTimeSlot: (
    value: ScheduleModalOpenResetPlan<SessionLike>["selectedTimeSlot"],
  ) => void;
  setIsModalOpen: (value: boolean) => void;
};

type ModalOpenPlanMode = "create" | "edit";

export const applyScheduleModalOpenPlan = <SessionLike>({
  mode,
  plan,
  setters,
}: {
  mode: ModalOpenPlanMode;
  plan: ScheduleModalOpenResetPlan<SessionLike>;
  setters: ModalOpenPlanSetters<SessionLike>;
}) => {
  setters.setRetryHint(plan.retryHint);
  setters.setPendingAgentIdempotencyKey(plan.pendingAgentIdempotencyKey);
  setters.setPendingAgentOperationId(plan.pendingAgentOperationId);
  setters.setPendingTraceRequestId(plan.pendingTraceRequestId);
  setters.setPendingTraceCorrelationId(plan.pendingTraceCorrelationId);

  if (mode === "create") {
    setters.setSelectedTimeSlot(plan.selectedTimeSlot);
    setters.setSelectedSession(plan.selectedSession);
  } else {
    setters.setSelectedSession(plan.selectedSession);
    setters.setSelectedTimeSlot(plan.selectedTimeSlot);
  }

  setters.setIsModalOpen(plan.isModalOpen);
};
