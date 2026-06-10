import { describe, expect, it } from "vitest";

import { buildLifecycleSessionNoteSeedPayload } from "../playwrightSessionLifecycleNoteSeed";

describe("buildLifecycleSessionNoteSeedPayload", () => {
  it("uses the session date and normalizes ISO timestamps to note fields", () => {
    expect(
      buildLifecycleSessionNoteSeedPayload({
        session: {
          sessionId: "session-1",
          organizationId: "org-1",
          clientId: "client-1",
          therapistId: "therapist-1",
          sessionDate: "2026-06-10",
          startTime: "2026-06-10T17:00:00.000Z",
          endTime: "2026-06-10T18:15:00.000Z",
          durationMinutes: 75,
        },
        authorizationId: "auth-1",
        serviceCode: "97153",
        actorUserId: "user-1",
        goalId: "goal-1",
      }),
    ).toEqual({
      authorization_id: "auth-1",
      client_id: "client-1",
      created_by: "user-1",
      end_time: "18:15:00",
      goal_ids: ["goal-1"],
      goal_notes: { "goal-1": "Playwright lifecycle goal note" },
      goals_addressed: ["goal-1"],
      is_locked: false,
      narrative: "Playwright lifecycle seeded session note",
      organization_id: "org-1",
      service_code: "97153",
      session_date: "2026-06-10",
      session_duration: 75,
      session_id: "session-1",
      start_time: "17:00:00",
      therapist_id: "therapist-1",
    });
  });

  it("derives the session date and duration when the session row does not provide them", () => {
    expect(
      buildLifecycleSessionNoteSeedPayload({
        session: {
          sessionId: "session-2",
          organizationId: "org-2",
          clientId: "client-2",
          therapistId: "therapist-2",
          sessionDate: null,
          startTime: "2026-06-11T09:30:00.000Z",
          endTime: "2026-06-11T10:15:00.000Z",
          durationMinutes: null,
        },
        authorizationId: "auth-2",
        serviceCode: "H2019",
        actorUserId: "user-2",
        goalId: "goal-2",
        noteText: "Completed through lifecycle smoke",
        narrative: "Seeded by playwright lifecycle",
      }),
    ).toEqual(
      expect.objectContaining({
        session_date: "2026-06-11",
        session_duration: 45,
        start_time: "09:30:00",
        end_time: "10:15:00",
        goal_notes: { "goal-2": "Completed through lifecycle smoke" },
        narrative: "Seeded by playwright lifecycle",
      }),
    );
  });
});
