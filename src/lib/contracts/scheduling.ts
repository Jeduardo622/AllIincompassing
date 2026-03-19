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

