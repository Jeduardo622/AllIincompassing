import { http, HttpResponse } from "msw";
import type { HoldResponse } from "../../src/lib/sessionHolds";
import type { BookSessionRequest } from "../../src/server/types";
import type { Session } from "../../src/types";
import { server } from "../../src/test/setup";

export type BookingRequestOverrides = Partial<Omit<BookSessionRequest, "session">> & {
  session?: Partial<BookSessionRequest["session"]>;
};

const DEFAULT_SESSION: BookSessionRequest["session"] = {
  therapist_id: "therapist-fixture-1",
  client_id: "client-fixture-1",
  start_time: "2025-07-01T15:00:00Z",
  end_time: "2025-07-01T16:00:00Z",
  status: "scheduled",
  notes: "Fixture session notes",
  session_type: "Individual",
  location_type: "clinic",
};

export function createBookingRequest(
  overrides?: BookingRequestOverrides,
): BookSessionRequest {
  return {
    session: {
      ...DEFAULT_SESSION,
      ...(overrides?.session ?? {}),
    },
    startTimeOffsetMinutes: overrides?.startTimeOffsetMinutes ?? 0,
    endTimeOffsetMinutes: overrides?.endTimeOffsetMinutes ?? 0,
    timeZone: overrides?.timeZone ?? "UTC",
    holdSeconds: overrides?.holdSeconds,
    idempotencyKey: overrides?.idempotencyKey,
    overrides: overrides?.overrides,
  };
}

const DEFAULT_HOLD: HoldResponse = {
  holdKey: "fixture-hold-key",
  holdId: "fixture-hold-id",
  expiresAt: "2025-07-01T15:05:00Z",
};

function computeDurationMinutes(request: BookSessionRequest): number | null {
  try {
    const start = new Date(request.session.start_time);
    const end = new Date(request.session.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    return diffMinutes > 0 ? diffMinutes : null;
  } catch {
    return null;
  }
}

export function createConfirmedSessionFromRequest(
  request: BookSessionRequest,
  overrides?: Partial<Session>,
): Session {
  const computedDuration = overrides?.duration_minutes ?? computeDurationMinutes(request) ?? null;

  const base: Session = {
    id: overrides?.id ?? "fixture-session-id",
    therapist_id: request.session.therapist_id,
    client_id: request.session.client_id,
    start_time: request.session.start_time,
    end_time: request.session.end_time,
    status: (request.session.status as Session["status"]) ?? "scheduled",
    notes:
      typeof request.session.notes === "string" && request.session.notes.length > 0
        ? request.session.notes
        : "Fixture session notes",
    created_at: overrides?.created_at ?? "2025-07-01T14:55:00Z",
    created_by: overrides?.created_by ?? "fixture-user",
    updated_at: overrides?.updated_at ?? "2025-07-01T14:55:00Z",
    updated_by: overrides?.updated_by ?? "fixture-user",
    duration_minutes: computedDuration,
  };

  return {
    ...base,
    ...overrides,
    duration_minutes: overrides?.duration_minutes ?? computedDuration,
  };
}

export interface BookingBillingSeedInput {
  request: BookSessionRequest;
  hold?: Partial<HoldResponse>;
  confirm?: {
    sessionOverrides?: Partial<Session>;
    roundedDurationMinutes?: number | null;
  };
}

export interface SeededBookingBilling {
  holdRequests: Array<Record<string, unknown>>;
  confirmRequests: Array<Record<string, unknown>>;
  hold: HoldResponse;
  confirmedSession: Session;
}

export function seedBookingBillingFixture(input: BookingBillingSeedInput): SeededBookingBilling {
  const hold: HoldResponse = {
    ...DEFAULT_HOLD,
    ...(input.hold ?? {}),
  };

  const confirmedSession = createConfirmedSessionFromRequest(
    input.request,
    input.confirm?.sessionOverrides,
  );

  const roundedDurationMinutes =
    input.confirm?.roundedDurationMinutes ?? confirmedSession.duration_minutes ?? null;

  const holdRequests: Array<Record<string, unknown>> = [];
  const confirmRequests: Array<Record<string, unknown>> = [];

  server.use(
    http.post("*/functions/v1/sessions-hold*", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      holdRequests.push(body);
      return HttpResponse.json({ success: true, data: hold });
    }),
    http.post("*/functions/v1/sessions-confirm*", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      confirmRequests.push(body);
      return HttpResponse.json({
        success: true,
        data: {
          session: confirmedSession,
          roundedDurationMinutes,
        },
      });
    }),
  );

  return { holdRequests, confirmRequests, hold, confirmedSession };
}
