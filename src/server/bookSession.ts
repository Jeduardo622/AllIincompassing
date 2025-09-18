import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../lib/sessionHolds";
import { deriveCptMetadata } from "./deriveCpt";
import { persistSessionCptMetadata } from "./sessionCptPersistence";
import type {
  BookSessionRequest,
  BookSessionResult,
  BookableSession,
  RequiredSessionFields,
} from "./types";

const REQUIRED_SESSION_FIELDS: Array<keyof RequiredSessionFields> = [
  "therapist_id",
  "client_id",
  "start_time",
  "end_time",
];

function assertSessionCompleteness(session: BookableSession) {
  for (const field of REQUIRED_SESSION_FIELDS) {
    const value = session[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing required session field: ${String(field)}`);
    }
  }
}

export async function bookSession(payload: BookSessionRequest): Promise<BookSessionResult> {
  if (!payload?.session) {
    throw new Error("Session payload is required");
  }

  assertSessionCompleteness(payload.session);

  const cpt = deriveCptMetadata({
    session: payload.session,
    overrides: payload.overrides,
  });

  const sessionId = typeof payload.session.id === "string" ? payload.session.id : undefined;

  const hold = await requestSessionHold({
    therapistId: payload.session.therapist_id,
    clientId: payload.session.client_id,
    startTime: payload.session.start_time,
    endTime: payload.session.end_time,
    sessionId,
    holdSeconds: payload.holdSeconds,
    idempotencyKey: payload.idempotencyKey,
    startTimeOffsetMinutes: payload.startTimeOffsetMinutes,
    endTimeOffsetMinutes: payload.endTimeOffsetMinutes,
    timeZone: payload.timeZone,
  });

  const sessionPayload: BookableSession = {
    ...payload.session,
    status: payload.session.status ?? "scheduled",
  };

  let confirmed;
  try {
    confirmed = await confirmSessionBooking({
      holdKey: hold.holdKey,
      session: sessionPayload,
      idempotencyKey: payload.idempotencyKey,
      startTimeOffsetMinutes: payload.startTimeOffsetMinutes,
      endTimeOffsetMinutes: payload.endTimeOffsetMinutes,
      timeZone: payload.timeZone,
    });
  } catch (error) {
    try {
      await cancelSessionHold({ holdKey: hold.holdKey });
    } catch (releaseError) {
      console.warn("Failed to release session hold after confirmation error", releaseError);
    }
    throw error;
  }

  try {
    const billedMinutes = typeof confirmed.duration_minutes === "number" && Number.isFinite(confirmed.duration_minutes)
      ? confirmed.duration_minutes
      : cpt.durationMinutes;

    await persistSessionCptMetadata({
      sessionId: confirmed.id,
      cpt,
      billedMinutes,
    });
  } catch (error) {
    console.error("Failed to persist CPT metadata for session", error);
    throw error;
  }

  return {
    session: confirmed,
    hold,
    cpt,
  };
}
