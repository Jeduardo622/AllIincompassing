import { useEffect } from "react";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPayrollDay,
  recordSessionAttendance,
  recordTimeEvent,
  requestSessionAttendanceCorrection,
  requestTimeCorrection,
  type PayrollScope,
  type PayrollSessionAttendanceCorrectionPayload,
  type PayrollSessionAttendancePayload,
  type PayrollTimeCorrectionPayload,
  type PayrollTimeEventPayload,
} from "./api";
import {
  createInMemoryPayrollOutboxStore,
  createIndexedDbPayrollOutboxStore,
  drainPayrollOutbox,
  enqueuePayrollOutboxEvent,
  listPayrollOutboxEvents,
  recoverPayrollOutbox,
  type PayrollOutboxStore,
} from "./outbox";

let defaultPayrollOutboxStore: PayrollOutboxStore | null = null;

const getDefaultPayrollOutboxStore = (): PayrollOutboxStore => {
  if (!defaultPayrollOutboxStore) {
    defaultPayrollOutboxStore = typeof indexedDB === "undefined"
      ? createInMemoryPayrollOutboxStore()
      : createIndexedDbPayrollOutboxStore();
  }
  return defaultPayrollOutboxStore;
};

export const payrollTimeQueryKey = (organizationId: string, userId: string, localDate: string) =>
  ["payroll-time", organizationId, userId, localDate] as const;

export const payrollOutboxQueryKey = (organizationId: string, userId: string) =>
  ["payroll-outbox", organizationId, userId] as const;

type UsePayrollTimeOptions = {
  store?: PayrollOutboxStore;
};

type UsePayrollDayReadOnlyOptions = {
  enabled?: boolean;
};

type QueuedTimeEventInput = PayrollScope & {
  idempotencyKey: string;
  event: PayrollTimeEventPayload;
};

type QueuedSessionAttendanceInput = PayrollScope & {
  idempotencyKey: string;
  event: PayrollSessionAttendancePayload;
};

type TimeCorrectionInput = PayrollScope & {
  idempotencyKey: string;
  correction: PayrollTimeCorrectionPayload;
};

type AttendanceCorrectionInput = PayrollScope & {
  idempotencyKey: string;
  correction: PayrollSessionAttendanceCorrectionPayload;
};

export function usePayrollTime(
  scope: PayrollScope,
  options: UsePayrollTimeOptions = {},
) {
  const store = options.store ?? getDefaultPayrollOutboxStore();
  const queryClient = useQueryClient();
  const dayKey = payrollTimeQueryKey(scope.organizationId, scope.userId, scope.localDate);
  const outboxKey = payrollOutboxQueryKey(scope.organizationId, scope.userId);

  useEffect(() => {
    let cancelled = false;

    const invalidateAfterDrain = async () => {
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      const drained = await drainPayrollOutbox({
        store,
        organizationId: scope.organizationId,
        userId: scope.userId,
        recordTimeEvent,
        recordSessionAttendance,
      });
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (drained.confirmedKeys.length > 0) {
        await queryClient.invalidateQueries({ queryKey: dayKey });
      }
    };

    void recoverPayrollOutbox(store, scope).then(async () => {
      if (cancelled) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (onlineManager.isOnline()) {
        await invalidateAfterDrain();
      }
    });

    const unsubscribe = onlineManager.subscribe((isOnline) => {
      if (!isOnline || cancelled) {
        return;
      }
      void invalidateAfterDrain();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dayKey, outboxKey, queryClient, scope, store]);

  const payrollDayQuery = useQuery({
    queryKey: dayKey,
    queryFn: () => fetchPayrollDay(scope),
  });

  const outboxQuery = useQuery({
    queryKey: outboxKey,
    queryFn: () => listPayrollOutboxEvents(store, scope),
  });

  const recordTimeEventMutation = useMutation({
    mutationFn: async (input: QueuedTimeEventInput) => {
      await enqueuePayrollOutboxEvent({
        store,
        organizationId: input.organizationId,
        userId: input.userId,
        localDate: input.localDate,
        action: "record_time_event",
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.event.occurredAt,
        payload: input.event,
      });
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (!onlineManager.isOnline()) {
        return { queued: true };
      }
      const drained = await drainPayrollOutbox({
        store,
        organizationId: input.organizationId,
        userId: input.userId,
        recordTimeEvent,
        recordSessionAttendance,
      });
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (drained.confirmedKeys.includes(input.idempotencyKey)) {
        await queryClient.invalidateQueries({ queryKey: dayKey });
      }
      return { queued: !drained.confirmedKeys.includes(input.idempotencyKey) };
    },
    networkMode: "always",
  });

  const recordSessionAttendanceMutation = useMutation({
    mutationFn: async (input: QueuedSessionAttendanceInput) => {
      await enqueuePayrollOutboxEvent({
        store,
        organizationId: input.organizationId,
        userId: input.userId,
        localDate: input.localDate,
        action: "record_session_attendance",
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.event.occurredAt,
        payload: input.event,
      });
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (!onlineManager.isOnline()) {
        return { queued: true };
      }
      const drained = await drainPayrollOutbox({
        store,
        organizationId: input.organizationId,
        userId: input.userId,
        recordTimeEvent,
        recordSessionAttendance,
      });
      await queryClient.invalidateQueries({ queryKey: outboxKey });
      if (drained.confirmedKeys.includes(input.idempotencyKey)) {
        await queryClient.invalidateQueries({ queryKey: dayKey });
      }
      return { queued: !drained.confirmedKeys.includes(input.idempotencyKey) };
    },
    networkMode: "always",
  });

  const requestTimeCorrectionMutation = useMutation({
    mutationFn: async (input: TimeCorrectionInput) => {
      const result = await requestTimeCorrection(input);
      await queryClient.invalidateQueries({ queryKey: dayKey });
      return result;
    },
    networkMode: "always",
  });

  const requestSessionAttendanceCorrectionMutation = useMutation({
    mutationFn: async (input: AttendanceCorrectionInput) => {
      const result = await requestSessionAttendanceCorrection(input);
      await queryClient.invalidateQueries({ queryKey: dayKey });
      return result;
    },
    networkMode: "always",
  });

  return {
    payrollDayQuery,
    outboxQuery,
    recordTimeEventMutation,
    recordSessionAttendanceMutation,
    requestTimeCorrectionMutation,
    requestSessionAttendanceCorrectionMutation,
  };
}

export function usePayrollDayReadOnly(
  scope: PayrollScope,
  options: UsePayrollDayReadOnlyOptions = {},
) {
  return useQuery({
    queryKey: payrollTimeQueryKey(scope.organizationId, scope.userId, scope.localDate),
    queryFn: () => fetchPayrollDay(scope),
    enabled: options.enabled ?? true,
  });
}
