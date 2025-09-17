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
}

export interface HoldResponse {
  holdKey: string;
  holdId: string;
  expiresAt: string;
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

type HoldEdgeResponse = EdgeSuccess<{ holdKey: string; holdId: string; expiresAt: string; }> | EdgeError;

type ConfirmEdgeResponse = EdgeSuccess<{
  session: Session;
  roundedDurationMinutes?: number | null;
}> | EdgeError;

function toError(message: string | undefined, fallback: string) {
  return new Error(message && message.length > 0 ? message : fallback);
}

export async function requestSessionHold(payload: HoldRequest): Promise<HoldResponse> {
  const response = await callEdge("sessions-hold", {
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
    }),
  });

  let body: HoldEdgeResponse | null = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Failed to parse hold response", error);
  }

  if (!response.ok || !body || !body.success) {
    throw toError(body?.error, "Failed to reserve session slot");
  }

  return body.data;
}

export interface ConfirmRequest {
  holdKey: string;
  session: Partial<Session>;
  idempotencyKey?: string;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone: string;
}

export async function confirmSessionBooking(payload: ConfirmRequest): Promise<Session> {
  const response = await callEdge("sessions-confirm", {
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
    }),
  });

  let body: ConfirmEdgeResponse | null = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Failed to parse confirmation response", error);
  }

  if (!response.ok || !body || !body.success) {
    throw toError(body?.error, "Failed to confirm session");
  }

  const { session, roundedDurationMinutes } = body.data;

  let normalizedDuration: number | null = null;
  if (typeof roundedDurationMinutes === "number" && Number.isFinite(roundedDurationMinutes)) {
    normalizedDuration = roundedDurationMinutes;
  } else if (typeof session.duration_minutes === "number" && Number.isFinite(session.duration_minutes)) {
    normalizedDuration = session.duration_minutes;
  }

  return normalizedDuration === null
    ? session
    : { ...session, duration_minutes: normalizedDuration };
}

export interface CancelHoldRequest {
  holdKey: string;
  idempotencyKey?: string;
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
  const response = await callEdge("sessions-cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
    },
    body: JSON.stringify({ hold_key: payload.holdKey }),
  });

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
