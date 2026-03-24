type ScheduleModalCreateSelection = {
  date: Date;
  time: string;
};

export type ScheduleModalOpenResetPlan<SessionLike> = {
  retryHint: null;
  pendingAgentIdempotencyKey: null;
  pendingAgentOperationId: null;
  pendingTraceRequestId: null;
  pendingTraceCorrelationId: null;
  selectedTimeSlot: ScheduleModalCreateSelection | undefined;
  selectedSession: SessionLike | undefined;
  isModalOpen: true;
};

type CreateModalOpenInput = {
  mode: "create";
  timeSlot: ScheduleModalCreateSelection;
};

type EditModalOpenInput<SessionLike> = {
  mode: "edit";
  session: SessionLike;
};

export const buildScheduleModalOpenResetPlan = <SessionLike>(
  input: CreateModalOpenInput | EditModalOpenInput<SessionLike>,
): ScheduleModalOpenResetPlan<SessionLike> => {
  if (input.mode === "create") {
    return {
      retryHint: null,
      pendingAgentIdempotencyKey: null,
      pendingAgentOperationId: null,
      pendingTraceRequestId: null,
      pendingTraceCorrelationId: null,
      selectedTimeSlot: input.timeSlot,
      selectedSession: undefined,
      isModalOpen: true,
    };
  }

  return {
    retryHint: null,
    pendingAgentIdempotencyKey: null,
    pendingAgentOperationId: null,
    pendingTraceRequestId: null,
    pendingTraceCorrelationId: null,
    selectedTimeSlot: undefined,
    selectedSession: input.session,
    isModalOpen: true,
  };
};
