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
  "therapist_id" | "client_id" | "start_time" | "end_time"
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
  holdSeconds?: number;
  idempotencyKey?: string;
  overrides?: BookingOverrides;
  accessToken: string;
  recurrence?: SessionRecurrence | null;
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

const bookingOverridesSchema = z.object({
  cptCode: nonEmptyString.optional(),
  modifiers: z.array(nonEmptyString).optional(),
});

const sessionSchema = z
  .object({
    therapist_id: nonEmptyString,
    client_id: nonEmptyString,
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
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .passthrough();

export const bookSessionApiRequestBodySchema = z.object({
  session: sessionSchema,
  startTimeOffsetMinutes: z.number().int(),
  endTimeOffsetMinutes: z.number().int(),
  timeZone: nonEmptyString,
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
}
