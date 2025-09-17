import type { Session } from "../types";
import { callEdge } from "./supabase";

export interface HoldRequest {
  therapistId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  sessionId?: string;
  holdSeconds?: number;
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

type ConfirmEdgeResponse = EdgeSuccess<{ session: Session }> | EdgeError;

function toError(message: string | undefined, fallback: string) {
  return new Error(message && message.length > 0 ? message : fallback);
}

export async function requestSessionHold(payload: HoldRequest): Promise<HoldResponse> {
  const response = await callEdge("sessions-hold", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      therapist_id: payload.therapistId,
      client_id: payload.clientId,
      start_time: payload.startTime,
      end_time: payload.endTime,
      session_id: payload.sessionId ?? null,
      hold_seconds: payload.holdSeconds ?? 300,
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
}

export async function confirmSessionBooking(payload: ConfirmRequest): Promise<Session> {
  const response = await callEdge("sessions-confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      hold_key: payload.holdKey,
      session: payload.session,
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

  return body.data.session;
}
