import type {
  PayrollMutationSuccess,
  PayrollScope,
  PayrollSessionAttendancePayload,
  PayrollSessionContext,
  PayrollSessionContextResponse,
  PayrollTimeEventPayload,
} from "../../payroll/api";
import {
  fetchSessionPayrollContext,
  payrollSessionContextResponseSchema,
  recordSessionAttendance,
  recordTimeEvent,
} from "../../payroll/api";
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
type FetchSessionContextResult =
  | PayrollSessionContextResponse
  | (Omit<PayrollSessionContext, "state"> & { state?: "ok" });

type AttendanceDescriptor = {
  idempotencyKey: string;
  occurredAt: string;
};

type ClosePreparationIdentity = {
  kind: "session_close_preparation";
  attendanceIdempotencyKey: string;
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
  }
  | {
    kind: "payroll_disabled";
  };
type ActiveStartPreparation = Exclude<StartPreparation, { kind: "payroll_disabled" }>;

type ExpectedStartPreparation = Pick<StartPreparation, "kind"> & {
  mode?: StartMode;
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

type ClosePreparation =
  | {
    kind: "payroll_disabled";
  }
  | {
    kind: "ready";
    context: PayrollSessionContext;
    attendance: AttendanceDescriptor;
  }
  | {
    kind: "attendance_not_confirmed";
    context: PayrollSessionContext;
    attendance: AttendanceDescriptor;
    reason: AttendanceReason;
  };

type CloseResult =
  | {
    kind: "completed";
    attendanceIdempotencyKey?: string;
    reconciledWithTerminalStatus: boolean;
  }
  | {
    kind: "attendance_not_confirmed";
    reason: AttendanceReason;
    attendanceIdempotencyKey: string;
  };

type StartClinicalResult = Awaited<ReturnType<typeof startSessionApiRequest>>;
type CompleteClinicalSessionFn = (request: CompleteSessionRequest) => Promise<void>;

type LifecycleDependencies = {
  store?: PayrollOutboxStore;
  fetchSessionContext?: (sessionId: string) => Promise<FetchSessionContextResult>;
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

type PrepareCloseSessionInput = {
  scope: PayrollScope;
  sessionId: string;
};

type CompletePreparedCloseInput = {
  scope: PayrollScope;
  request: CompleteSessionRequest;
  preparation?: ClosePreparationIdentity;
  runClinicalClose?: CompleteClinicalSessionFn;
};

export type SessionPayrollStartChoice = StartChoice;
export type SessionPayrollStartResult = StartResult;
export type SessionPayrollPrepareCloseResult =
  | { kind: "payroll_disabled" }
  | { kind: "ready"; preparation: ClosePreparationIdentity }
  | { kind: "attendance_not_confirmed"; reason: AttendanceReason };
export type SessionPayrollCloseResult = CloseResult;

const createIdempotencyKey = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `payroll-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const deriveScopedLocalDate = (
  occurredAt: string,
  timeZone: string,
): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(occurredAt));
  const getPart = (type: "year" | "month" | "day"): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Failed to derive payroll localDate from ${occurredAt} in ${timeZone}.`);
    }
    return value;
  };

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
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

const deriveExpectedStartPreparation = (
  context: PayrollSessionContext,
): ExpectedStartPreparation => {
  if (context.actorIsAssignedEmployee && !context.activeShiftEventId) {
    return { kind: "clock_choice_required" };
  }

  return {
    kind: "ready",
    mode: context.actorIsAssignedEmployee ? "active" : "delegated",
  };
};

const assertRetainedNotNeedsAttention = (retained: PendingPayrollEvent | null): void => {
  if (retained?.state === "needs_attention" || retained?.safeCode) {
    throw new Error("Retained payroll outbox event requires attention.");
  }
};

const getRetainedAttendanceLink = (
  retained: PendingPayrollEvent | null,
): string | null | undefined =>
  (retained?.payload as { data?: { employeeTimeEventId?: string | null } } | undefined)?.data?.employeeTimeEventId;

const assertPreparedSessionMatchesRequest = (
  prepared: ActiveStartPreparation,
  request: StartSessionRequest,
): void => {
  if (prepared.context.sessionId !== request.sessionId) {
    throw new Error("Prepared payroll session context does not match the requested session.");
  }
};

const assertPreparedMatchesFreshContext = (
  prepared: StartPreparation,
  freshContext: PayrollSessionContext,
): ExpectedStartPreparation => {
  const expected = deriveExpectedStartPreparation(freshContext);

  if (prepared.kind !== expected.kind) {
    throw new Error("Prepared payroll session context is stale for start execution.");
  }
  if (expected.kind === "ready" && prepared.mode !== expected.mode) {
    throw new Error("Prepared payroll start mode is stale for start execution.");
  }

  return expected;
};

const assertAllowedStartChoice = (
  expected: ExpectedStartPreparation,
  choice: StartChoice,
  freshContext: PayrollSessionContext,
): void => {
  if (expected.kind === "clock_choice_required") {
    if (choice !== "clock_in" && choice !== "continue_without_clock_in") {
      throw new Error("Clock-choice-required start accepts only clock_in or continue_without_clock_in.");
    }
    if (choice === "clock_in") {
      if (!freshContext.actorIsAssignedEmployee) {
        throw new Error("Only the assigned employee may clock in from session start.");
      }
      if (!freshContext.canClockSelf) {
        throw new Error("The assigned employee cannot self-clock for this session.");
      }
    }
    return;
  }

  if (expected.mode === "active" && choice !== "active") {
    throw new Error("Ready active start accepts only the active choice.");
  }
  if (expected.mode === "delegated" && choice !== "delegated") {
    throw new Error("Ready delegated start accepts only the delegated choice.");
  }
};

const buildSyntheticRetainedEvent = (
  scope: PayrollScope,
  attendance: AttendanceDescriptor,
  localDate: string,
): PendingPayrollEvent => ({
  storageKey: JSON.stringify([scope.organizationId, scope.userId, localDate, attendance.idempotencyKey]),
  organizationId: scope.organizationId,
  userId: scope.userId,
  localDate,
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

const INVALID_SESSION_CONTEXT_ERROR = "Received invalid payroll session context response.";

const normalizeSessionContextResult = (
  result: FetchSessionContextResult,
): PayrollSessionContextResponse => {
  const parsed = payrollSessionContextResponseSchema.safeParse(result);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof result === "object" && result !== null && !Array.isArray(result) && !("state" in result)) {
    const legacyParsed = payrollSessionContextResponseSchema.safeParse({
      ...result,
      state: "ok",
    });
    if (legacyParsed.success && legacyParsed.data.state === "ok") {
      return legacyParsed.data;
    }
  }
  throw new Error(INVALID_SESSION_CONTEXT_ERROR);
};

const toClosePreparationIdentity = (
  attendance: AttendanceDescriptor,
): ClosePreparationIdentity => ({
  kind: "session_close_preparation",
  attendanceIdempotencyKey: attendance.idempotencyKey,
  occurredAt: attendance.occurredAt,
});

const defaultDependencies = (): Required<LifecycleDependencies> => ({
  store: getDefaultPayrollOutboxStore(),
  fetchSessionContext: (sessionId) => fetchSessionPayrollContext(sessionId, { allowDisabled: true }),
  enqueueOutboxEvent: enqueuePayrollOutboxEvent,
  drainOutbox: drainPayrollOutbox,
  findRetainedEvent: findRetainedSessionAttendanceEvent,
  reconfirmRetainedEvent: reconfirmRetainedPayrollOutboxEvent,
  clearRetainedEvent: clearRetainedPayrollOutboxEvent,
  recordTimeEvent,
  recordSessionAttendance,
  startClinicalSession: startSessionApiRequest,
  completeClinicalSession: async () => {
    throw new Error("completeClinicalSession is not wired for session payroll lifecycle close.");
  },
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

    const localDate = deriveScopedLocalDate(attendance.occurredAt, context.employmentTimezone);

    await deps.enqueueOutboxEvent({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      localDate,
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
    })) ?? buildSyntheticRetainedEvent(scope, attendance, localDate);
  };

  const rewriteRetainedAttendance = async (
    scope: PayrollScope,
    context: PayrollSessionContext,
    eventType: SessionAttendanceEventType,
    employeeTimeEventId: string | null | undefined,
    retained: PendingPayrollEvent,
  ): Promise<PendingPayrollEvent | null> => {
    await deps.enqueueOutboxEvent({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      localDate: retained.localDate,
      action: "record_session_attendance",
      idempotencyKey: retained.idempotencyKey,
      occurredAt: retained.occurredAt,
      payload: buildAttendancePayload(context, eventType, retained.occurredAt, employeeTimeEventId),
      retainForClinical: true,
    });

    return (await deps.findRetainedEvent({
      store: deps.store,
      organizationId: scope.organizationId,
      userId: scope.userId,
      sessionId: context.sessionId,
      eventType,
    })) ?? buildSyntheticRetainedEvent(scope, {
      idempotencyKey: retained.idempotencyKey,
      occurredAt: retained.occurredAt,
    }, retained.localDate);
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

  const prepareCloseInternal = async (
    input: PrepareCloseSessionInput,
    expectedPreparation?: ClosePreparationIdentity,
  ): Promise<ClosePreparation> => {
    const contextResponse = normalizeSessionContextResult(
      await deps.fetchSessionContext(input.sessionId),
    );
    if (contextResponse.state === "feature_disabled") {
      return { kind: "payroll_disabled" };
    }
    const context = contextResponse;
    let retained = await deps.findRetainedEvent({
      store: deps.store,
      organizationId: input.scope.organizationId,
      userId: input.scope.userId,
      sessionId: input.sessionId,
      eventType: "session_ended",
    });
    assertRetainedNotNeedsAttention(retained);
    if (
      expectedPreparation
      && (
        !retained
        || retained.idempotencyKey !== expectedPreparation.attendanceIdempotencyKey
        || retained.occurredAt !== expectedPreparation.occurredAt
      )
    ) {
      throw new Error("Prepared payroll close attendance is stale.");
    }
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
        context,
        attendance: retained
          ? {
            idempotencyKey: retained.idempotencyKey,
            occurredAt: retained.occurredAt,
          }
          : attendance,
      };
    }

    const authoritativeAttendance = retained
      ? {
        idempotencyKey: retained.idempotencyKey,
        occurredAt: retained.occurredAt,
      }
      : attendance;

    return {
      kind: "ready",
      context,
      attendance: authoritativeAttendance,
    };
  };

  const prepareCloseSession = async (
    input: PrepareCloseSessionInput,
  ): Promise<SessionPayrollPrepareCloseResult> => {
    const prepared = await prepareCloseInternal(input);
    if (prepared.kind === "payroll_disabled") {
      return { kind: "payroll_disabled" };
    }
    if (prepared.kind === "attendance_not_confirmed") {
      return {
        kind: "attendance_not_confirmed",
        reason: prepared.reason,
      };
    }
    return {
      kind: "ready",
      preparation: toClosePreparationIdentity(prepared.attendance),
    };
  };

  const completePreparedClose = async (
    input: CompletePreparedCloseInput,
  ): Promise<CloseResult> => {
    const prepared = await prepareCloseInternal({
      scope: input.scope,
      sessionId: input.request.sessionId,
    }, input.preparation);
    const runClinicalClose = input.runClinicalClose ?? deps.completeClinicalSession;

    if (prepared.kind === "payroll_disabled") {
      await runClinicalClose(input.request);
      return {
        kind: "completed",
        reconciledWithTerminalStatus: false,
      };
    }

    if (prepared.kind === "attendance_not_confirmed") {
      return {
        kind: "attendance_not_confirmed",
        reason: prepared.reason,
        attendanceIdempotencyKey: prepared.attendance.idempotencyKey,
      };
    }

    try {
      await runClinicalClose(input.request);
    } catch (error) {
      if (!isAlreadyTerminalError(error)) {
        throw error;
      }

      const exactMatch = await deps.revalidateTerminalOutcome({
        sessionId: input.request.sessionId,
        organizationId: prepared.context.organizationId,
        outcome: input.request.outcome,
      });
      if (!exactMatch) {
        throw error;
      }

      await deps.clearRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        idempotencyKey: prepared.attendance.idempotencyKey,
        confirmedServerIdempotencyKey: prepared.attendance.idempotencyKey,
      });
      return {
        kind: "completed",
        attendanceIdempotencyKey: prepared.attendance.idempotencyKey,
        reconciledWithTerminalStatus: true,
      };
    }

    await deps.clearRetainedEvent({
      store: deps.store,
      organizationId: input.scope.organizationId,
      userId: input.scope.userId,
      idempotencyKey: prepared.attendance.idempotencyKey,
      confirmedServerIdempotencyKey: prepared.attendance.idempotencyKey,
    });
    return {
      kind: "completed",
      attendanceIdempotencyKey: prepared.attendance.idempotencyKey,
      reconciledWithTerminalStatus: false,
    };
  };

  return {
    async prepareStart(input: PrepareInput): Promise<StartPreparation> {
      const contextResponse = normalizeSessionContextResult(
        await deps.fetchSessionContext(input.sessionId),
      );
      if (contextResponse.state === "feature_disabled") {
        return { kind: "payroll_disabled" };
      }
      const context = contextResponse;
      const retained = await deps.findRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        sessionId: input.sessionId,
        eventType: "session_started",
      });
      assertRetainedNotNeedsAttention(retained);
      const attendance = getAttendanceFromRetained(retained, deps.now(), deps.createIdempotencyKey);
      const expected = deriveExpectedStartPreparation(context);

      if (expected.kind === "clock_choice_required") {
        return {
          kind: "clock_choice_required",
          context,
          attendance,
        };
      }

      return {
        kind: "ready",
        mode: expected.mode,
        context,
        attendance,
      };
    },

    async executeStart(input: ExecuteStartInput): Promise<StartResult> {
      if (input.prepared.kind === "payroll_disabled") {
        throw new Error("Payroll-disabled start preparation cannot execute payroll attendance.");
      }
      assertPreparedSessionMatchesRequest(input.prepared, input.request);
      const freshContextResponse = normalizeSessionContextResult(
        await deps.fetchSessionContext(input.request.sessionId),
      );
      if (freshContextResponse.state === "feature_disabled") {
        throw new Error("Payroll session context became feature_disabled before start execution.");
      }
      const freshContext = freshContextResponse;
      const expected = assertPreparedMatchesFreshContext(input.prepared, freshContext);
      assertAllowedStartChoice(expected, input.choice, freshContext);

      let attendanceDescriptor = input.prepared.attendance;
      const initialContext = freshContext;
      let shiftIdempotencyKey: string | undefined;
      let contextForAttendance = initialContext;
      let employeeTimeEventId: string | null | undefined;
      let retained = await deps.findRetainedEvent({
        store: deps.store,
        organizationId: input.scope.organizationId,
        userId: input.scope.userId,
        sessionId: input.request.sessionId,
        eventType: "session_started",
      });
      assertRetainedNotNeedsAttention(retained);
      if (retained) {
        attendanceDescriptor = {
          idempotencyKey: retained.idempotencyKey,
          occurredAt: retained.occurredAt,
        };
      }

      if (input.choice === "clock_in") {
        if (retained?.state === "confirmed_pending_clinical") {
          throw new Error("A confirmed retained session start cannot be rewritten for a clock-in retry.");
        }

        shiftIdempotencyKey = deps.createIdempotencyKey();

        await deps.enqueueOutboxEvent({
          store: deps.store,
          organizationId: input.scope.organizationId,
          userId: input.scope.userId,
          localDate: deriveScopedLocalDate(
            attendanceDescriptor.occurredAt,
            initialContext.employmentTimezone,
          ),
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

        const refetchedContextResponse = normalizeSessionContextResult(
          await deps.fetchSessionContext(input.request.sessionId),
        );
        if (refetchedContextResponse.state === "feature_disabled") {
          throw new Error("Payroll session context became feature_disabled after clock-in confirmation.");
        }
        contextForAttendance = refetchedContextResponse;
        if (!contextForAttendance.activeShiftEventId) {
          throw new Error("Clock-in start requires an authoritative active shift after confirmation.");
        }
        employeeTimeEventId = contextForAttendance.activeShiftEventId;
      } else if (input.choice === "active") {
        employeeTimeEventId = initialContext.activeShiftEventId;
      } else {
        employeeTimeEventId = undefined;
      }
      const retainedLink = getRetainedAttendanceLink(retained);
      if (retained?.state === "confirmed_pending_clinical" && retainedLink !== employeeTimeEventId) {
        throw new Error("A confirmed retained session start cannot be retroactively relinked.");
      }

      if (retained && retained.state !== "confirmed_pending_clinical" && retainedLink !== employeeTimeEventId) {
        retained = await rewriteRetainedAttendance(
          input.scope,
          contextForAttendance,
          "session_started",
          employeeTimeEventId,
          retained,
        );
      } else {
        retained = await ensureRetainedAttendance(
          input.scope,
          contextForAttendance,
          "session_started",
          employeeTimeEventId,
          retained,
          attendanceDescriptor,
        );
      }
      if (retained) {
        attendanceDescriptor = {
          idempotencyKey: retained.idempotencyKey,
          occurredAt: retained.occurredAt,
        };
      }
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

    prepareCloseSession,
    completePreparedClose,
    closeSession: async (input: CloseSessionInput): Promise<CloseResult> =>
      completePreparedClose(input),
  };
}
