import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookSession } from "../src/server/bookSession";
import {
  createBookingRequest,
  seedBookingBillingFixture,
} from "./fixtures/bookingBilling";
import { resetSessionCptClient } from "../src/server/sessionCptPersistence";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
};

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("booking billing integration", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    resetSessionCptClient();
  });

  afterEach(() => {
    if (typeof originalSupabaseUrl === "string") {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    } else {
      delete process.env.SUPABASE_URL;
    }

    if (typeof originalServiceRoleKey === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
    resetSessionCptClient();
  });

  it("derives CPT metadata using session type, location, and overrides", async () => {
    const request = createBookingRequest({
      session: {
        session_type: "Group",
        location_type: "Telehealth - school campus",
        start_time: "2025-07-01T15:00:00Z",
        end_time: "2025-07-01T18:15:00Z",
      },
      overrides: {
        modifiers: ["gt"],
      },
      idempotencyKey: "billing-e2e-group",
      holdSeconds: 420,
    });

    const seeded = seedBookingBillingFixture({
      request,
      hold: {
        holdKey: "group-hold-key",
        holdId: "group-hold-id",
        expiresAt: "2025-07-01T15:10:00Z",
      },
      confirm: {
        sessionOverrides: {
          id: "group-session-id",
          notes: "Group telehealth session",
        },
      },
    });

    const result = await bookSession(request);

    expect(result.hold).toMatchObject({
      holdKey: "group-hold-key",
      holdId: "group-hold-id",
      expiresAt: "2025-07-01T15:10:00Z",
    });

    expect(result.session).toMatchObject({
      id: "group-session-id",
      therapist_id: request.session.therapist_id,
      client_id: request.session.client_id,
      start_time: request.session.start_time,
      end_time: request.session.end_time,
      duration_minutes: 195,
    });

    expect(result.cpt).toEqual({
      code: "97154",
      description: "Group adaptive behavior treatment by protocol",
      modifiers: ["GT", "HQ", "95", "KX"],
      source: "session_type",
      durationMinutes: 195,
    });

    expect(seeded.holdRequests).toHaveLength(1);
    expect(seeded.holdRequests[0]).toMatchObject({
      therapist_id: request.session.therapist_id,
      client_id: request.session.client_id,
      start_time: request.session.start_time,
      end_time: request.session.end_time,
      session_id: null,
      hold_seconds: 420,
      start_time_offset_minutes: request.startTimeOffsetMinutes,
      end_time_offset_minutes: request.endTimeOffsetMinutes,
      time_zone: request.timeZone,
    });

    expect(seeded.confirmRequests).toHaveLength(1);
    const confirmPayload = asRecord(seeded.confirmRequests[0]);
    expect(confirmPayload).toMatchObject({
      hold_key: "group-hold-key",
      time_zone: request.timeZone,
      start_time_offset_minutes: request.startTimeOffsetMinutes,
      end_time_offset_minutes: request.endTimeOffsetMinutes,
    });

    const confirmedSessionPayload = asRecord(confirmPayload.session);
    expect(confirmedSessionPayload).toMatchObject({
      therapist_id: request.session.therapist_id,
      client_id: request.session.client_id,
      session_type: request.session.session_type,
      location_type: request.session.location_type,
      status: "scheduled",
    });

    expect(seeded.sessionCptEntries).toHaveLength(1);
    const cptEntry = seeded.sessionCptEntries[0];
    expect(cptEntry).toMatchObject({
      session_id: seeded.confirmedSession.id,
      cpt_code_id: "cpt-97154",
      line_number: 1,
      units: 13,
      billed_minutes: 195,
      is_primary: true,
      notes: "Group adaptive behavior treatment by protocol",
    });

    expect(seeded.sessionCptModifiers).toHaveLength(4);
    const modifierEntryIds = new Set(
      seeded.sessionCptModifiers.map((modifier) => modifier.session_cpt_entry_id),
    );
    expect(modifierEntryIds).toEqual(new Set([cptEntry.id]));
    expect(seeded.sessionCptModifiers.map((modifier) => modifier.modifier_id)).toEqual([
      "modifier-GT",
      "modifier-HQ",
      "modifier-95",
      "modifier-KX",
    ]);
    expect(seeded.sessionCptModifiers.map((modifier) => modifier.position)).toEqual([1, 2, 3, 4]);
  });

  it("honors explicit CPT overrides and normalizes modifiers", async () => {
    const request = createBookingRequest({
      session: {
        session_type: "Consultation",
        location_type: "Remote home visit",
        start_time: "2025-07-02T09:00:00Z",
        end_time: "2025-07-02T09:50:00Z",
      },
      overrides: {
        cptCode: "97155",
        modifiers: [" tz ", "95"],
      },
    });

    const seeded = seedBookingBillingFixture({
      request,
      hold: {
        holdKey: "override-hold-key",
      },
      confirm: {
        sessionOverrides: {
          id: "override-session-id",
          duration_minutes: 50,
        },
        roundedDurationMinutes: 50,
      },
    });

    const result = await bookSession(request);

    expect(result.cpt).toEqual({
      code: "97155",
      description: "Adaptive behavior treatment with protocol modification",
      modifiers: ["TZ", "95"],
      source: "override",
      durationMinutes: 50,
    });

    expect(result.session).toMatchObject({
      id: "override-session-id",
      duration_minutes: 50,
    });

    expect(seeded.holdRequests).toHaveLength(1);
    expect(seeded.holdRequests[0]).toMatchObject({
      hold_seconds: 300,
    });

    const confirmPayload = asRecord(seeded.confirmRequests[0]);
    expect(confirmPayload).toMatchObject({
      hold_key: "override-hold-key",
      time_zone: request.timeZone,
    });

    const sessionPayload = asRecord(confirmPayload.session);
    expect(sessionPayload).toMatchObject({
      session_type: request.session.session_type,
      location_type: request.session.location_type,
    });

    expect(seeded.sessionCptEntries).toHaveLength(1);
    const entry = seeded.sessionCptEntries[0];
    expect(entry).toMatchObject({
      session_id: seeded.confirmedSession.id,
      cpt_code_id: "cpt-97155",
      line_number: 1,
      billed_minutes: 50,
      units: 3,
      is_primary: true,
      notes: "Adaptive behavior treatment with protocol modification",
    });

    expect(seeded.sessionCptModifiers).toHaveLength(2);
    expect(new Set(seeded.sessionCptModifiers.map((modifier) => modifier.session_cpt_entry_id))).toEqual(
      new Set([entry.id]),
    );
    expect(seeded.sessionCptModifiers.map((modifier) => modifier.modifier_id)).toEqual([
      "modifier-TZ",
      "modifier-95",
    ]);
    expect(seeded.sessionCptModifiers.map((modifier) => modifier.position)).toEqual([1, 2]);
  });
});
