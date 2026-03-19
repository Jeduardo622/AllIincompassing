import { z } from "zod";

export const baseApiEnvelopeSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  hint: z.string().optional(),
  retryAfter: z.string().nullable().optional(),
  retryAfterSeconds: z.number().nullable().optional(),
  orchestration: z.record(z.unknown()).nullable().optional(),
});

export const parseJsonResponse = async <T>(
  response: Response,
  schema: z.ZodSchema<T>,
): Promise<T | null> => {
  try {
    const payload = await response.json();
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

