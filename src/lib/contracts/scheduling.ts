import { z } from "zod";
import { baseApiEnvelopeSchema } from "../sdk/contracts";

export const sessionsStartRequestSchema = z.object({
  session_id: z.string().uuid(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  started_at: z.string().optional(),
});

export const sessionsStartSuccessSchema = z.object({
  id: z.string(),
  started_at: z.string(),
});

export const sessionsStartEnvelopeSchema = baseApiEnvelopeSchema.extend({
  data: sessionsStartSuccessSchema.optional(),
});

export const sessionsStartSuccessPayloadSchema = z.union([
  sessionsStartEnvelopeSchema,
  sessionsStartSuccessSchema,
]);

export const bookSessionResultSchema = z.object({
  session: z.record(z.unknown()),
  sessions: z.array(z.record(z.unknown())).optional(),
  hold: z.record(z.unknown()),
  cpt: z.record(z.unknown()),
});

export const bookSessionEnvelopeSchema = baseApiEnvelopeSchema.extend({
  success: z.literal(true),
  data: bookSessionResultSchema,
});

export const weekForwardConflictSchema = z.object({
  sourceSessionId: z.string(),
  conflictingSessionId: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  therapistId: z.string(),
  clientId: z.string(),
  code: z.string(),
  message: z.string(),
});

export const weekForwardPreviewResultSchema = z.object({
  sourceSessionCount: z.number().int().nonnegative(),
  generatedSessionCount: z.number().int().nonnegative(),
  generatedWeekCount: z.number().int().nonnegative(),
  endDate: z.string(),
  conflicts: z.array(weekForwardConflictSchema),
});

export const weekForwardCommitResultSchema = weekForwardPreviewResultSchema.extend({
  createdSessions: z.array(z.record(z.unknown())),
});

export const weekForwardEnvelopeSchema = baseApiEnvelopeSchema.extend({
  data: z.union([weekForwardPreviewResultSchema, weekForwardCommitResultSchema]).optional(),
});

