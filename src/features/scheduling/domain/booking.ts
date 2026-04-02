import type {
  BookSessionApiRequestBody,
  BookSessionResult,
} from "../../../server/types";
import type { Session } from "../../../types";
import { parseISO } from "date-fns";
import { getTimezoneOffset } from "date-fns-tz";
import { supabase } from "../../../lib/supabase";
import { logger } from "../../../lib/logger/logger";
import { toError } from "../../../lib/logger/normalizeError";
import { callApiRoute } from "../../../lib/sdk/client";
import { parseJsonResponse } from "../../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../../lib/sdk/errors";
import { bookSessionEnvelopeSchema } from "../../../lib/contracts/scheduling";

const DEFAULT_SESSION_HOLD_SECONDS = 5 * 60;

export type BookingTraceHeaders = {
  idempotencyKey?: string;
  agentOperationId?: string;
  requestId?: string;
  correlationId?: string;
};

export function createIdempotencyKey(): string | undefined {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (error) {
      logger.warn("Failed to generate idempotency key", {
        metadata: {
          failure: toError(error, "Idempotency key generation failed").message,
        },
      });
    }
  }
  return undefined;
}

const getSessionAccessToken = async (): Promise<string | null> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token?.trim();
  return token && token.length > 0 ? token : null;
};

export function buildBookSessionApiPayload(
  session: Partial<Session>,
  metadata: {
    startOffsetMinutes: number;
    endOffsetMinutes: number;
    timeZone: string;
  },
  recurrence?: BookSessionApiRequestBody["recurrence"],
  holdSeconds = DEFAULT_SESSION_HOLD_SECONDS,
): BookSessionApiRequestBody {
  const normalizedSession = {
    ...session,
    status: session.status ?? "scheduled",
  } as BookSessionApiRequestBody["session"];

  return {
    session: normalizedSession,
    startTimeOffsetMinutes: metadata.startOffsetMinutes,
    endTimeOffsetMinutes: metadata.endOffsetMinutes,
    timeZone: metadata.timeZone,
    holdSeconds,
    ...(recurrence ? { recurrence } : {}),
  };
}

export function buildBookingTimeMetadata(session: Pick<Partial<Session>, "start_time" | "end_time">, timeZone?: string): {
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  timeZone: string;
} {
  if (!session.start_time || !session.end_time) {
    throw new Error("Missing session start or end time");
  }

  const startDate = parseISO(session.start_time);
  const endDate = parseISO(session.end_time);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid session time provided");
  }

  const resolvedTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    startOffsetMinutes: Math.round(getTimezoneOffset(resolvedTimeZone, startDate) / 60000),
    endOffsetMinutes: Math.round(getTimezoneOffset(resolvedTimeZone, endDate) / 60000),
    timeZone: resolvedTimeZone,
  };
}

export async function bookSessionViaApi(
  payload: BookSessionApiRequestBody,
  trace?: BookingTraceHeaders,
): Promise<BookSessionResult> {
  const idempotencyKey = trace?.idempotencyKey ?? createIdempotencyKey();
  const token = await getSessionAccessToken();
  if (!token) {
    throw new Error("Authentication is required to book sessions");
  }

  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  if (trace?.agentOperationId) {
    headers["x-agent-operation-id"] = trace.agentOperationId;
  }

  const response = await callApiRoute(
    "/api/book",
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    {
      accessToken: token,
      trace: {
        requestId: trace?.requestId,
        correlationId: trace?.correlationId,
        agentOperationId: trace?.agentOperationId,
      },
    },
  );

  const responseForParsing = response.clone();
  const parsed = await parseJsonResponse(responseForParsing, bookSessionEnvelopeSchema);
  if (!response.ok || !parsed) {
    let fallbackPayload: Record<string, unknown> | null = null;
    try {
      fallbackPayload = await response.json() as Record<string, unknown>;
    } catch {
      fallbackPayload = null;
    }
    throw toNormalizedApiError(
      fallbackPayload,
      response.status,
      "Failed to book session",
    );
  }

  return parsed.data as unknown as BookSessionResult;
}

export const asBookingError = (error: unknown): NormalizedApiError => {
  if (error instanceof Error) {
    return error as NormalizedApiError;
  }
  return new Error(String(error)) as NormalizedApiError;
};

