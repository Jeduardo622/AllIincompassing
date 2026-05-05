import { z } from "zod";
import type { Session } from "../types";
import type { HoldResponse } from "../lib/sessionHolds";

export interface SessionRecurrence {
  rule: string;
  count?: number;
  until?: string;
  exceptions?: string[];
  timeZone?: string;
}

export interface RecurrenceOccurrence {
  startTime: string;
  endTime: string;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface BookingOverrides {
  cptCode?: string;
  modifiers?: string[];
}

export type RequiredSessionFields = Pick<
  Session,
  "therapist_id" | "client_id" | "program_id" | "goal_id" | "start_time" | "end_time"
>;

export type BookableSession = RequiredSessionFields &
  Partial<Omit<Session, keyof RequiredSessionFields>> & {
    recurrence?: SessionRecurrence | null;
  };

export interface BookSessionRequest {
  session: BookableSession;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone: string;
  occurrences?: RecurrenceOccurrence[];
  holdSeconds?: number;
  idempotencyKey?: string;
  overrides?: BookingOverrides;
  accessToken: string;
  anonKey?: string;
  recurrence?: SessionRecurrence | null;
  trace?: {
    requestId?: string;
    correlationId?: string;
    agentOperationId?: string;
  };
}

export interface DerivedCpt {
  code: string;
  description: string;
  modifiers: string[];
  source: "override" | "session_type" | "fallback";
  durationMinutes: number | null;
}

export interface BookSessionResult {
  session: Session;
  sessions: Session[];
  hold: HoldResponse;
  cpt: DerivedCpt;
}

const nonEmptyString = z.string().trim().min(1);

const isoDateTime = z.string().datetime({ offset: true });

const recurrenceSchema = z.object({
  rule: nonEmptyString,
  count: z.number().int().positive().optional(),
  until: isoDateTime.optional(),
  exceptions: z.array(isoDateTime).optional(),
  timeZone: nonEmptyString.optional(),
});

const occurrenceSchema = z.object({
  startTime: isoDateTime,
  endTime: isoDateTime,
  startOffsetMinutes: z.number().int(),
  endOffsetMinutes: z.number().int(),
});

const bookingOverridesSchema = z.object({
  cptCode: nonEmptyString.optional(),
  modifiers: z.array(nonEmptyString).optional(),
});

const sessionSchema = z
  .object({
    therapist_id: nonEmptyString,
    client_id: nonEmptyString,
    program_id: nonEmptyString,
    goal_id: nonEmptyString,
    start_time: isoDateTime,
    end_time: isoDateTime,
    id: nonEmptyString.optional(),
    status: nonEmptyString.optional(),
    notes: z.string().optional(),
    created_at: isoDateTime.optional(),
    created_by: nonEmptyString.nullable().optional(),
    updated_at: isoDateTime.optional(),
    updated_by: nonEmptyString.nullable().optional(),
    duration_minutes: z.number().int().positive().nullable().optional(),
    rate_per_hour: z.number().nonnegative().nullable().optional(),
    total_cost: z.number().nonnegative().nullable().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .passthrough()
  .superRefine((session, ctx) => {
    if (
      typeof session.rate_per_hour === "number" &&
      typeof session.total_cost === "number" &&
      typeof session.duration_minutes === "number" &&
      session.duration_minutes > 0
    ) {
      const expectedTotal = Number(((session.rate_per_hour * session.duration_minutes) / 60).toFixed(2));
      if (Math.abs(session.total_cost - expectedTotal) > 0.05) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["total_cost"],
          message: "total_cost must align with rate_per_hour and duration_minutes",
        });
      }
    }
  });

export const bookSessionApiRequestBodySchema = z.object({
  session: sessionSchema,
  startTimeOffsetMinutes: z.number().int(),
  endTimeOffsetMinutes: z.number().int(),
  timeZone: nonEmptyString,
  occurrences: z.array(occurrenceSchema).min(1).optional(),
  holdSeconds: z.number().int().min(0).optional(),
  overrides: bookingOverridesSchema.optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});

export type BookSessionApiRequestBody = z.infer<typeof bookSessionApiRequestBodySchema>;

export interface BookSessionApiResponse {
  success: boolean;
  data?: BookSessionResult;
  error?: string;
  code?: string;
  hint?: string;
  retryAfter?: string | null;
  retryAfterSeconds?: number | null;
  orchestration?: Record<string, unknown> | null;
}

export interface WeekForwardConflict {
  sourceSessionId: string;
  conflictingSessionId?: string;
  startTime: string;
  endTime: string;
  therapistId: string;
  clientId: string;
  code: string;
  message: string;
}

export interface WeekForwardPreviewResult {
  sourceSessionCount: number;
  generatedSessionCount: number;
  generatedWeekCount: number;
  endDate: string;
  conflicts: WeekForwardConflict[];
}

export interface WeekForwardCommitResult extends WeekForwardPreviewResult {
  createdSessions: Session[];
}

export const weekForwardConflictSchema = z.object({
  sourceSessionId: nonEmptyString,
  conflictingSessionId: nonEmptyString.optional(),
  startTime: isoDateTime,
  endTime: isoDateTime,
  therapistId: nonEmptyString,
  clientId: nonEmptyString,
  code: nonEmptyString,
  message: nonEmptyString,
});

const isoDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const weekForwardRequestBodySchema = z.object({
  sourceSessionIds: z.array(nonEmptyString).min(1),
  displayedWeekStart: isoDateTime,
  displayedWeekEnd: isoDateTime,
  endDate: isoDateOnly,
  timeZone: nonEmptyString,
  dryRun: z.boolean(),
});

export type WeekForwardRequestBody = z.infer<typeof weekForwardRequestBodySchema>;

export const weekForwardPreviewResultSchema = z.object({
  sourceSessionCount: z.number().int().nonnegative(),
  generatedSessionCount: z.number().int().nonnegative(),
  generatedWeekCount: z.number().int().nonnegative(),
  endDate: isoDateOnly,
  conflicts: z.array(weekForwardConflictSchema),
});

export const weekForwardCommitResultSchema = weekForwardPreviewResultSchema.extend({
  createdSessions: z.array(z.record(z.unknown())),
});

export const weekForwardApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.union([weekForwardPreviewResultSchema, weekForwardCommitResultSchema]).optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  hint: z.string().optional(),
});

export interface WeekForwardApiResponse {
  success: boolean;
  data?: WeekForwardPreviewResult | WeekForwardCommitResult;
  error?: string;
  code?: string;
  hint?: string;
}
