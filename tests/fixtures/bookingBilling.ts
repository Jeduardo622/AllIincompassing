import { randomUUID } from "node:crypto";
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

const DEFAULT_CPT_CODES = [
  { id: "cpt-97151", code: "97151" },
  { id: "cpt-97153", code: "97153" },
  { id: "cpt-97154", code: "97154" },
  { id: "cpt-97155", code: "97155" },
  { id: "cpt-97156", code: "97156" },
];

const DEFAULT_BILLING_MODIFIERS = [
  { id: "modifier-GT", code: "GT" },
  { id: "modifier-HQ", code: "HQ" },
  { id: "modifier-95", code: "95" },
  { id: "modifier-KX", code: "KX" },
  { id: "modifier-HO", code: "HO" },
  { id: "modifier-TZ", code: "TZ" },
];

function parseEqParameter(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.startsWith("eq.") ? raw.slice(3) : raw;
  return value.length > 0 ? value : null;
}

function parseInParameter(raw: string | null): string[] {
  if (!raw || !raw.startsWith("in.")) {
    return [];
  }
  const value = raw.slice(3);
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return [];
  }
  return value
    .slice(1, -1)
    .split(",")
    .map((candidate) => candidate.replaceAll('"', "").trim())
    .filter((candidate) => candidate.length > 0);
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
  sessionCptEntries: Array<Record<string, unknown>>;
  sessionCptModifiers: Array<Record<string, unknown>>;
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
  const sessionCptEntries: Array<Record<string, unknown>> = [];
  const sessionCptModifiers: Array<Record<string, unknown>> = [];

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
    http.get("*/rest/v1/cpt_codes*", async ({ request }) => {
      const url = new URL(request.url);
      const code = parseEqParameter(url.searchParams.get("code"));
      const matches = typeof code === "string"
        ? DEFAULT_CPT_CODES.filter((candidate) => candidate.code === code)
        : DEFAULT_CPT_CODES;
      const rangeUpper = matches.length > 0 ? matches.length - 1 : 0;
      return HttpResponse.json(matches, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${rangeUpper}/${matches.length}`,
        },
      });
    }),
    http.get("*/rest/v1/billing_modifiers*", async ({ request }) => {
      const url = new URL(request.url);
      const codes = parseInParameter(url.searchParams.get("code"));
      const matches = codes.length > 0
        ? DEFAULT_BILLING_MODIFIERS.filter((modifier) => codes.includes(modifier.code))
        : DEFAULT_BILLING_MODIFIERS;
      const rangeUpper = matches.length > 0 ? matches.length - 1 : 0;
      return HttpResponse.json(matches, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${rangeUpper}/${matches.length}`,
        },
      });
    }),
    http.delete("*/rest/v1/session_cpt_entries*", async ({ request }) => {
      const url = new URL(request.url);
      const sessionId = parseEqParameter(url.searchParams.get("session_id"));
      if (typeof sessionId === "string") {
        const removedIds = sessionCptEntries
          .filter((entry) => entry.session_id === sessionId)
          .map((entry) => entry.id)
          .filter((value): value is string => typeof value === "string");
        for (let index = sessionCptEntries.length - 1; index >= 0; index -= 1) {
          if (sessionCptEntries[index]?.session_id === sessionId) {
            sessionCptEntries.splice(index, 1);
          }
        }
        for (let index = sessionCptModifiers.length - 1; index >= 0; index -= 1) {
          if (removedIds.includes(sessionCptModifiers[index]?.session_cpt_entry_id as string)) {
            sessionCptModifiers.splice(index, 1);
          }
        }
      }
      return HttpResponse.json([], { status: 204 });
    }),
    http.get("*/rest/v1/session_cpt_entries*", async ({ request }) => {
      const url = new URL(request.url);
      const sessionId = parseEqParameter(url.searchParams.get("session_id"));
      const matches = typeof sessionId === "string"
        ? sessionCptEntries.filter((entry) => entry.session_id === sessionId)
        : sessionCptEntries;
      const rangeUpper = matches.length > 0 ? matches.length - 1 : 0;
      return HttpResponse.json(matches, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${rangeUpper}/${matches.length}`,
        },
      });
    }),
    http.post("*/rest/v1/session_cpt_entries", async ({ request }) => {
      const body = (await request.json().catch(() => [])) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const inserted = rows.map((row) => {
        const entry = {
          id: typeof row.id === "string" && row.id.length > 0 ? row.id : `sce-${randomUUID()}`,
          session_id: row.session_id,
          cpt_code_id: row.cpt_code_id,
          line_number: row.line_number ?? 1,
          units: row.units ?? 1,
          billed_minutes: row.billed_minutes ?? null,
          is_primary: row.is_primary ?? false,
          notes: row.notes ?? null,
        };
        sessionCptEntries.push(entry);
        return { id: entry.id };
      });

      const rangeUpper = inserted.length > 0 ? inserted.length - 1 : 0;
      return HttpResponse.json(inserted, {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${rangeUpper}/${inserted.length}`,
        },
      });
    }),
    http.post("*/rest/v1/session_cpt_modifiers", async ({ request }) => {
      const body = (await request.json().catch(() => [])) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const inserted = rows.map((row, index) => {
        const modifier = {
          id: typeof row.id === "string" && row.id.length > 0 ? row.id : `scm-${randomUUID()}`,
          session_cpt_entry_id: row.session_cpt_entry_id,
          modifier_id: row.modifier_id,
          position: row.position ?? index + 1,
        };
        sessionCptModifiers.push(modifier);
        return { modifier_id: modifier.modifier_id };
      });
      const rangeUpper = inserted.length > 0 ? inserted.length - 1 : 0;
      return HttpResponse.json(inserted, {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${rangeUpper}/${inserted.length}`,
        },
      });
    }),
  );

  return {
    holdRequests,
    confirmRequests,
    hold,
    confirmedSession,
    sessionCptEntries,
    sessionCptModifiers,
  };
}
