import type {
  PayrollMutationSuccess,
  PayrollScope,
  PayrollSessionAttendancePayload,
  PayrollSessionContext,
  PayrollTimeEventPayload,
} from "../../payroll/api";
import { fetchSessionPayrollContext, recordSessionAttendance, recordTimeEvent } from "../../payroll/api";
import {
  clearRetainedPayrollOutboxEvent,
  createInMemoryPayrollOutboxStore,
  drainPayrollOutbox,
  enqueuePayrollOutboxEvent,
  findRetainedSessionAttendanceEvent,
  reconfirmRetainedPayrollOutboxEvent,
  type PendingPayrollEvent,
  type PayrollOutboxStore,
} from "../../payroll/outbox";
import { getDefaultPayrollOutboxStore, isPayrollTransportOnline } from "../../payroll/usePayrollTime";
import { revalidateTerminalSessionOutcome, type CompleteSessionRequest } from "./sessionComplete";
import { startSessionApiRequest, type StartSessionRequest } from "./sessionStart";

type SessionAttendanceEventType = "session_started" | "session_ended";
type StartMode = "active" | "delegated";
type StartChoice = StartMode | "continue_without_clock_in" | "clock_in";
type AttendanceReason = "offline" | "not_confirmed";

type AttendanceDescriptor = {
  idempotencyKey: string;
  occurredAt: string;
};

type StartPreparation =
  | {
    kind: "ready";
    mode: StartMode;
    context: PayrollSessionContext;
    attendance: AttendanceDescriptor;
  }
  | {
    kind: "clock_choice_required";
    context: PayrollSessionContext;
    attendance: AttendanceDescriptor;
  };

type StartResult =
  | {
    kind: "started";
    attendanceIdempotencyKey: string;
    shiftIdempotencyKey?: string;
  }
  | {
    kind: "attendance_not_confirmed";
    reason: AttendanceReason;
    attendanceIdempotencyKey: string;
    shiftIdempotencyKey?: string;
  };

type CloseResult =
  | {
    kind: "completed";
    attendanceIdempotencyKey: string;
    reconciledWithTerminalStatus: boolean;
  }
  | {
    kind: "attendance_not_confirmed";
    reason: AttendanceReason;
    attendanceIdempotencyKey: string;
  };

type StartClinicalResult = Awaited<ReturnType<typeof startSessionApiRequest>>;

type LifecycleDependencies = {
  store?: PayrollOutboxStore;
  fetchSessionContext?: (sessionId: string) => Promise<PayrollSessionContext>;
  enqueueOutboxEvent?: typeof enqueuePayrollOutboxEvent;
  drainOutbox?: typeof drainPayrollOutbox;
  findRetainedEvent?: (input: {
    store: PayrollOutboxStore;
    organizationId: string;
    userId: string;
    sessionId: string;
    eventType: SessionAttendanceEventType;
  }) => Promise<PendingPayrollEvent | null>;
  reconfirmRetainedEvent?: typeof reconfirmRetainedPayrollOutboxEvent;
  clearRetainedEvent?: typeof clearRetainedPayrollOutboxEvent;
  recordTimeEvent?: (input: PayrollScope & { idempotencyKey: string; event: PayrollTimeEventPayload }) => Promise<PayrollMutationSuccess>;
  recordSessionAttendance?: (input: PayrollScope & { idempotencyKey: string; event: PayrollSessionAttendancePayload }) => Promise<PayrollMutationSuccess>;
  startClinicalSession?: (request: StartSessionRequest) => Promise<StartClinicalResult>;
  completeClinicalSession?: (request: CompleteSessionRequest) => Promise<void>;
  revalidateTerminalOutcome?: typeof revalidateTerminalSessionOutcome;
  isOnline?: () => boolean;
  createIdempotencyKey?: () => string;
  now?: () => string;
};

type PrepareInput = {
  scope: PayrollScope;
  sessionId: string;
};

type ExecuteStartInput = {
  scope: PayrollScope;
  prepared: StartPreparation;
  choice: StartChoice;
  request: StartSessionRequest;
};

type CloseSessionInput = {
  scope: PayrollScope;
  request: CompleteSessionRequest;
};

const createIdempotencyKey = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `payroll-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const buildAttendancePayload = (
  context: PayrollSessionContext,
  eventType: SessionAttendanceEventType,
  occurredAt: string,
  employeeTimeEventId?: string | null,
): PayrollSessionAttendancePayload => ({
  occurredAt,
  timezone: context.employmentTimezone,
  workLocation: context.canonicalWorkLocation,
  data: {
    eventType,
    sessionId: context.sessionId,
    ...(employeeTimeEventId === undefined ? {} : { employeeTimeEventId }),
  },
});

const buildShiftStartedPayload = (
  context: PayrollSessionContext,
  occurredAt: string,
): PayrollTimeEventPayload => ({
  occurredAt,
  timezone: context.employmentTimezone,
  workLocation: context.canonicalWorkLocation,
  data: {
    eventType: "shift_started",
  },
});

const getAttendanceFromRetained = (
  retained: PendingPayrollEvent | null,
  fallbackOccurredAt: string,
  makeKey: () => string,
): AttendanceDescriptor => ({
  idempotencyKey: retained?.idempotencyKey ?? makeKey(),
  occurredAt: retained?.occurredAt ?? fallbackOccurredAt,
});

const assertRetainedNotNeedsAttention = (retained: PendingPayrollEvent | null): void => {
  if (retained?.state === "needs_attention" || retained?.safeCode) {
    throw new Error("Retained payroll outbox event requires attention.");
  }
};

const buildSyntheticRetainedEvent = (
  scope: PayrollScope,
  attendance: AttendanceDescriptor,
): PendingPayrollEvent => ({
  storageKey: JSON.stringify([scope.organizationId, scope.userId, attendance.idempotencyKey]),
  organizationId: scope.organizationId,
  userId: scope.userId,
  localDate: scope.localDate,
  idempotencyKey: attendance.idempotencyKey,
  action: "record_session_attendance",
  occurredAt: attendance.occurredAt,
  payload: {},
  enqueueSequence: 0,
  enqueuedAt: attendance.occurredAt,
  state: "pending",
  safeCode: null,
  retainForClinical: true,
});

const wasAttendanceConfirmed = (
  retained: PendingPayrollEvent | null,
  confirmedKeys: string[],
): boolean => retained?.state === "confirmed_pending_clinical" || confirmedKeys.includes(retained?.idempotencyKey ?? "");

const isAlreadyTerminalError = (error: unknown): boolean =>
  (error as { code?: unknown })?.code === "ALREADY_TERMINAL";

const defaultDependencies = (): Required<LifecycleDependencies> => ({
  store: getDefaultPayrollOutboxStore(),
  fetchSessionContext: fetchSessionPayrollContext,
  enqueueOutboxEvent: enqueuePayrollOutboxEvent,
  drainOutbox: drainPayrollOutbox,
  findRetainedEvent: findRetainedSessionAttendanceEvent,
  reconfirmRetainedEvent: reconfirmRetainedPayrollOutboxEvent,
  clearRetainedEvent: clearRetainedPayrollOutboxEvent,
  recordTimeEvent,
  recordSessionAttendance,
  startClinicalSession: startSessionApiRequest,
  completeClinicalSession: async () => undefined,
  revalidateTerminalOutcome: revalidateTerminalSessionOutcome,
  isOnline: isPayrollTransportOnline,
  createIdempotencyKey,
  now: () => new Date().toISOString(),
});

export function createSessionPayrollLifecycle(
  overrides: LifecycleDependencies = {},
) {
  const defaults = defaultDependencies();
  const deps = {
    store: overrides.store ?? defaults.store ?? createInMemoryPayrollOutboxStore(),
    fetchSessionContext: overrides.fetchSessionContext ?? defaults.fetchSessionContext,
    enqueueOutboxEvent: overrides.enqueueOutboxEvent ?? defaults.enqueueOutboxEvent,
    drainOutbox: overrides.drainOutbox ?? defaults.drainOutbox,
    findRetainedEvent: overrides.findRetainedEvent ?? defaults.findRetainedEvent,
    reconfirmRetainedEvent: overrides.reconfirmRetainedEvent ?? defaults.reconfirmRetainedEvent,
    clearRetainedEvent: overrides.clearRetainedEvent ?? defaults.clearRetainedEvent,
    recordTimeEvent: overrides.recordTimeEvent ?? defaults.recordTimeEvent,
    recordSessionAttendance: overrides.recordSessionAttendance ?? defaults.recordSessionAttendance,
    startClinicalSession: overrides.startClinicalSession ?? defaults.startClinicalSession,
    completeClinicalSession: overrides.completeClinicalSession ?? defaults.completeClinicalSession,
    revalidateTerminalOutcome: overrides.revalidateTerminalOutcome ?? defaults.revalidateTerminalOutcome,
    isOnline: overrides.isOnline ?? defaults.isOnline,
    createIdempotencyKey: overrides.createIdempotencyKey ?? defaults.createIdempotencyKey,
    now: overrides.now ?? defaults.now,
  };

  const ensureRetainedAttendance = async (
    scope: PayrollScope,
    context: PayrollSessionContext,
    eventType: SessionAttendanceEventType,
    employeeTimeEventId: string | null | undefined,
    retained: PendingPayrollEvent | null,
    attendance: AttendanceDescriptor,
  ): Promise<PendingPayrollEvent | null> => {
    if (retained) {
      return retained;
    }

    await deps.enqueueOutboxEvent({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      localDate: scope.localDate,
      action: "record_session_attendance",
      idempotencyKey: attendance.idempotencyKey,
      occurredAt: attendance.occurredAt,
      payload: buildAttendancePayload(context, eventType, attendance.occurredAt, employeeTimeEventId),
      retainForClinical: true,
    });

    return (await deps.findRetainedEvent({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      sessionId: context.sessionId,
      eventType,
    })) ?? buildSyntheticRetainedEvent(scope, attendance);
  };

  const confirmRetainedAttendance = async (
    scope: PayrollScope,
    retained: PendingPayrollEvent | null,
  ): Promise<{ confirmed: boolean; reason?: AttendanceReason }> => {
    if (!retained) {
      return { confirmed: false, reason: deps.isOnline() ? "not_confirmed" : "offline" };
    }

    if (retained.state === "confirmed_pending_clinical") {
      await deps.reconfirmRetainedEvent({
        store: deps.store,
        organizationId: scope.organizationId,
        userId: scope.userId,
        idempotencyKey: retained.idempotencyKey,
        recordSessionAttendance: deps.recordSessionAttendance,
      });
      return { confirmed: true };
    }

    if (!deps.isOnline()) {
      return { confirmed: false, reason: "offline" };
    }

    const drained = await deps.drainOutbox({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      recordTimeEvent: deps.recordTimeEvent,
      recordSessionAttendance: deps.recordSessionAttendance,
    });

    return {
      confirmed: wasAttendanceConfirmed(retained, drained.confirmedKeys),
      reason: drained.confirmedKeys.includes(retained.idempotencyKey) ? undefined : "not_confirmed",
    };
  };

  return {
    async prepareStart(input: PrepareInput): Promise<StartPreparation> {
      const context = await deps.fetchSessionContext(input.sessionId);
      const retained = await deps.findRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        sessionId: input.sessionId,
        eventType: "session_started",
      });
      assertRetainedNotNeedsAttention(retained);
      const attendance = getAttendanceFromRetained(retained, deps.now(), deps.createIdempotencyKey);

      if (context.actorIsAssignedEmployee && !context.activeShiftEventId) {
        return {
          kind: "clock_choice_required",
          context,
          attendance,
        };
      }

      return {
        kind: "ready",
        mode: context.actorIsAssignedEmployee ? "active" : "delegated",
        context,
        attendance,
      };
    },

    async executeStart(input: ExecuteStartInput): Promise<StartResult> {
      const attendanceDescriptor = input.prepared.attendance;
      const initialContext = input.prepared.context;
      let shiftIdempotencyKey: string | undefined;
      let contextForAttendance = initialContext;
      let employeeTimeEventId: string | null | undefined;

      if (input.choice === "clock_in") {
        shiftIdempotencyKey = deps.createIdempotencyKey();

        await deps.enqueueOutboxEvent({
          store: deps.store,
          organizationId: input.scope.organizationId,
          userId: input.scope.userId,
          localDate: input.scope.localDate,
          action: "record_time_event",
          idempotencyKey: shiftIdempotencyKey,
          occurredAt: attendanceDescriptor.occurredAt,
          payload: buildShiftStartedPayload(initialContext, attendanceDescriptor.occurredAt),
        });

        if (!deps.isOnline()) {
          return {
            kind: "attendance_not_confirmed",
            reason: "offline",
            attendanceIdempotencyKey: attendanceDescriptor.idempotencyKey,
            shiftIdempotencyKey,
          };
        }

        const drained = await deps.drainOutbox({
          store: deps.store,
          organizationId: input.scope.organizationId,
          userId: input.scope.userId,
          recordTimeEvent: deps.recordTimeEvent,
          recordSessionAttendance: deps.recordSessionAttendance,
        });

        if (!drained.confirmedKeys.includes(shiftIdempotencyKey)) {
          return {
            kind: "attendance_not_confirmed",
            reason: "not_confirmed",
            attendanceIdempotencyKey: attendanceDescriptor.idempotencyKey,
            shiftIdempotencyKey,
          };
        }

        contextForAttendance = await deps.fetchSessionContext(input.request.sessionId);
        employeeTimeEventId = contextForAttendance.activeShiftEventId;
      } else if (input.choice === "active") {
        employeeTimeEventId = initialContext.activeShiftEventId;
      } else {
        employeeTimeEventId = undefined;
      }

      let retained = await deps.findRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        sessionId: input.request.sessionId,
        eventType: "session_started",
      });
      assertRetainedNotNeedsAttention(retained);

      retained = await ensureRetainedAttendance(
        input.scope,
        contextForAttendance,
        "session_started",
        employeeTimeEventId,
        retained,
        attendanceDescriptor,
      );
      const confirmation = await confirmRetainedAttendance(input.scope, retained);
      if (!confirmation.confirmed) {
        return {
          kind: "attendance_not_confirmed",
          reason: confirmation.reason ?? "not_confirmed",
          attendanceIdempotencyKey: attendanceDescriptor.idempotencyKey,
          ...(shiftIdempotencyKey ? { shiftIdempotencyKey } : {}),
        };
      }

      const clinical = await deps.startClinicalSession(input.request);
      if (clinical.outcome === "started" || clinical.outcome === "already_started") {
        await deps.clearRetainedEvent({
          store: deps.store,
          organizationId: input.scope.organizationId,
          userId: input.scope.userId,
          idempotencyKey: attendanceDescriptor.idempotencyKey,
          confirmedServerIdempotencyKey: attendanceDescriptor.idempotencyKey,
        });
      }

      return {
        kind: "started",
        attendanceIdempotencyKey: attendanceDescriptor.idempotencyKey,
        ...(shiftIdempotencyKey ? { shiftIdempotencyKey } : {}),
      };
    },

    async closeSession(input: CloseSessionInput): Promise<CloseResult> {
      const context = await deps.fetchSessionContext(input.request.sessionId);
      let retained = await deps.findRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        sessionId: input.request.sessionId,
        eventType: "session_ended",
      });
      assertRetainedNotNeedsAttention(retained);
      const attendance = getAttendanceFromRetained(retained, deps.now(), deps.createIdempotencyKey);

      retained = await ensureRetainedAttendance(
        input.scope,
        context,
        "session_ended",
        undefined,
        retained,
        attendance,
      );
      const confirmation = await confirmRetainedAttendance(input.scope, retained);
      if (!confirmation.confirmed) {
        return {
          kind: "attendance_not_confirmed",
          reason: confirmation.reason ?? "not_confirmed",
          attendanceIdempotencyKey: attendance.idempotencyKey,
        };
      }

      try {
        await deps.completeClinicalSession(input.request);
      } catch (error) {
        if (!isAlreadyTerminalError(error)) {
          throw error;
        }

        const exactMatch = await deps.revalidateTerminalOutcome({
          sessionId: input.request.sessionId,
          organizationId: context.organizationId,
          outcome: input.request.outcome,
        });
        if (!exactMatch) {
          throw error;
        }

        await deps.clearRetainedEvent({
          store: deps.store,
          organizationId: input.scope.organizationId,
          userId: input.scope.userId,
          idempotencyKey: attendance.idempotencyKey,
          confirmedServerIdempotencyKey: attendance.idempotencyKey,
        });
        return {
          kind: "completed",
          attendanceIdempotencyKey: attendance.idempotencyKey,
          reconciledWithTerminalStatus: true,
        };
      }

      await deps.clearRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        idempotencyKey: attendance.idempotencyKey,
        confirmedServerIdempotencyKey: attendance.idempotencyKey,
      });
      return {
        kind: "completed",
        attendanceIdempotencyKey: attendance.idempotencyKey,
        reconciledWithTerminalStatus: false,
      };
    },
  };
}
