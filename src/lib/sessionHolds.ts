import type { Session } from "../types";
import { callEdge } from "./supabase";

export interface HoldRequest {
  therapistId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  sessionId?: string;
  holdSeconds?: number;
  idempotencyKey?: string;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone: string;
  accessToken?: string;
  occurrences?: HoldOccurrenceRequest[];
}

export interface HoldOccurrenceRequest {
  startTime: string;
  endTime: string;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
}

export interface HoldOccurrence {
  holdKey: string;
  holdId: string;
  startTime: string;
  endTime: string;
  expiresAt: string;
}

export interface HoldResponse extends HoldOccurrence {
  holds: HoldOccurrence[];
}

interface EdgeSuccess<T> {
  success: true;
  data: T;
}

interface EdgeError {
  success: false;
  error?: string;
  code?: string;
}

type HoldEdgeResponse = EdgeSuccess<{
  holdKey: string;
  holdId: string;
  expiresAt: string;
  holds: HoldOccurrence[];
}> | EdgeError;

type ConfirmEdgeResponse = EdgeSuccess<{
  session: Session;
  sessions?: Session[];
  roundedDurationMinutes?: number | null;
}> | EdgeError;

export interface ConfirmOccurrenceRequest {
  holdKey: string;
  session: Partial<Session>;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone?: string;
}

export type ConfirmSessionResponse = {
  session: Session;
  sessions: Session[];
  roundedDurationMinutes?: number | null;
};

function toError(message: string | undefined, fallback: string) {
  return new Error(message && message.length > 0 ? message : fallback);
}

export async function requestSessionHold(payload: HoldRequest): Promise<HoldResponse> {
  const occurrencePayloads: HoldOccurrenceRequest[] = Array.isArray(payload.occurrences) && payload.occurrences.length > 0
    ? payload.occurrences
    : [{
        startTime: payload.startTime,
        endTime: payload.endTime,
        startTimeOffsetMinutes: payload.startTimeOffsetMinutes,
        endTimeOffsetMinutes: payload.endTimeOffsetMinutes,
      }];

  const response = await callEdge(
    "sessions-hold",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        therapist_id: payload.therapistId,
        client_id: payload.clientId,
        start_time: payload.startTime,
        end_time: payload.endTime,
        session_id: payload.sessionId ?? null,
        hold_seconds: payload.holdSeconds ?? 300,
        start_time_offset_minutes: payload.startTimeOffsetMinutes,
        end_time_offset_minutes: payload.endTimeOffsetMinutes,
        time_zone: payload.timeZone,
        occurrences: occurrencePayloads.map((occurrence) => ({
          start_time: occurrence.startTime,
          end_time: occurrence.endTime,
          start_time_offset_minutes: occurrence.startTimeOffsetMinutes,
          end_time_offset_minutes: occurrence.endTimeOffsetMinutes,
        })),
      }),
    },
    { accessToken: payload.accessToken },
  );

  let body: HoldEdgeResponse | null = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Failed to parse hold response", error);
  }

  if (!response.ok || !body || !body.success) {
    throw toError(body?.error, "Failed to reserve session slot");
  }

  const holds = Array.isArray(body.data.holds) && body.data.holds.length > 0
    ? body.data.holds
    : occurrencePayloads.map((occurrence) => ({
        holdKey: body.data.holdKey,
        holdId: body.data.holdId,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        expiresAt: body.data.expiresAt,
      }));

  const [primaryHold] = holds;
  if (!primaryHold) {
    throw new Error("Hold response missing primary occurrence");
  }

  return {
    ...body.data,
    startTime: primaryHold.startTime,
    endTime: primaryHold.endTime,
    expiresAt: body.data.expiresAt ?? primaryHold.expiresAt,
    holds,
  };
}

export interface ConfirmRequest {
  holdKey: string;
  session: Partial<Session>;
  idempotencyKey?: string;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone: string;
  accessToken?: string;
  occurrences?: ConfirmOccurrenceRequest[];
}

export async function confirmSessionBooking(payload: ConfirmRequest): Promise<ConfirmSessionResponse> {
  const response = await callEdge(
    "sessions-confirm",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        hold_key: payload.holdKey,
        session: payload.session,
        start_time_offset_minutes: payload.startTimeOffsetMinutes,
        end_time_offset_minutes: payload.endTimeOffsetMinutes,
        time_zone: payload.timeZone,
        occurrences: payload.occurrences?.map((occurrence) => ({
          hold_key: occurrence.holdKey,
          session: occurrence.session,
          start_time_offset_minutes: occurrence.startTimeOffsetMinutes,
          end_time_offset_minutes: occurrence.endTimeOffsetMinutes,
          time_zone: occurrence.timeZone ?? payload.timeZone,
        })),
      }),
    },
    { accessToken: payload.accessToken },
  );

  let body: ConfirmEdgeResponse | null = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Failed to parse confirmation response", error);
  }

  if (!response.ok || !body || !body.success) {
    throw toError(body?.error, "Failed to confirm session");
  }

  const { session, sessions, roundedDurationMinutes } = body.data;

  const normalizedSessions = Array.isArray(sessions) && sessions.length > 0
    ? sessions
    : [session];

  const normalized = normalizedSessions.map((current) => {
    let duration: number | null = null;

    if (typeof roundedDurationMinutes === "number" && Number.isFinite(roundedDurationMinutes)) {
      duration = roundedDurationMinutes;
    } else if (typeof current.duration_minutes === "number" && Number.isFinite(current.duration_minutes)) {
      duration = current.duration_minutes;
    } else if (typeof current.duration_minutes === "string") {
      const trimmed = current.duration_minutes.trim();
      if (trimmed.length > 0) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          duration = parsed;
        }
      }
    }

    return duration === null
      ? current
      : { ...current, duration_minutes: duration };
  });

  return {
    session: normalized[0],
    sessions: normalized,
    roundedDurationMinutes,
  };
}

export interface CancelHoldRequest {
  holdKey: string;
  idempotencyKey?: string;
  accessToken?: string;
}

export interface CancelHoldResponse {
  released: boolean;
  hold?: {
    id: string;
    holdKey: string;
    therapistId: string;
    clientId: string;
    startTime: string;
    endTime: string;
    expiresAt: string;
  };
}

export async function cancelSessionHold(payload: CancelHoldRequest): Promise<CancelHoldResponse> {
  const response = await callEdge(
    "sessions-cancel",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({ hold_key: payload.holdKey }),
    },
    { accessToken: payload.accessToken },
  );

  let body: EdgeSuccess<{ released: boolean; hold?: CancelHoldResponse["hold"] }> | EdgeError | null = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Failed to parse cancel response", error);
  }

  if (!response.ok || !body || !body.success) {
    throw toError(body?.error, "Failed to release session hold");
  }

  return body.data;
}
