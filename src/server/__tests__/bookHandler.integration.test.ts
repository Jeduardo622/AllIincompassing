import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookHandler } from "../api/book";

const { callEdgeMock, persistSessionCptMetadataMock } = vi.hoisted(() => ({
  callEdgeMock: vi.fn(),
  persistSessionCptMetadataMock: vi
    .fn()
    .mockResolvedValue({ entryId: "entry-id", modifierIds: [] }),
}));

vi.mock("../../lib/supabase", async () => {
  const actual = await vi.importActual<typeof import("../../lib/supabase")>("../../lib/supabase");
  return {
    ...actual,
    callEdge: callEdgeMock,
  };
});

vi.mock("../sessionCptPersistence", () => ({
  persistSessionCptMetadata: persistSessionCptMetadataMock,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bookHandler integration", () => {
  const payload = {
    session: {
      therapist_id: "therapist-1",
      client_id: "client-1",
      start_time: "2025-01-01T10:00:00Z",
      end_time: "2025-01-01T11:00:00Z",
    },
    startTimeOffsetMinutes: 0,
    endTimeOffsetMinutes: 0,
    timeZone: "UTC",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls edge functions with the bearer token from the request", async () => {
    const accessToken = "integration-token";
    callEdgeMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            holdKey: "hold-key",
            holdId: "hold-id",
            expiresAt: "2025-01-01T09:05:00Z",
            holds: [
              {
                holdKey: "hold-key",
                holdId: "hold-id",
                startTime: payload.session.start_time,
                endTime: payload.session.end_time,
                expiresAt: "2025-01-01T09:05:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            session: {
              id: "session-1",
              therapist_id: payload.session.therapist_id,
              client_id: payload.session.client_id,
              start_time: payload.session.start_time,
              end_time: payload.session.end_time,
              status: "scheduled",
              notes: "",
              created_at: "2025-01-01T09:00:00Z",
              created_by: "user-1",
              updated_at: "2025-01-01T09:00:00Z",
              updated_by: "user-1",
              duration_minutes: 60,
            },
            sessions: [
              {
                id: "session-1",
                therapist_id: payload.session.therapist_id,
                client_id: payload.session.client_id,
                start_time: payload.session.start_time,
                end_time: payload.session.end_time,
                status: "scheduled",
                notes: "",
                created_at: "2025-01-01T09:00:00Z",
                created_by: "user-1",
                updated_at: "2025-01-01T09:00:00Z",
                updated_by: "user-1",
                duration_minutes: 60,
              },
            ],
            roundedDurationMinutes: 60,
          },
        }),
      );

    const response = await bookHandler(
      new Request("http://localhost/api/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-1");
    expect(callEdgeMock).toHaveBeenCalledTimes(2);
    expect(callEdgeMock).toHaveBeenNthCalledWith(
      1,
      "sessions-hold",
      expect.any(Object),
      { accessToken },
    );
    expect(callEdgeMock).toHaveBeenNthCalledWith(
      2,
      "sessions-confirm",
      expect.any(Object),
      { accessToken },
    );
    expect(persistSessionCptMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });

  it("rejects unauthorized requests before invoking edge functions", async () => {
    const response = await bookHandler(
      new Request("http://localhost/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(401);
    expect(callEdgeMock).not.toHaveBeenCalled();
    expect(persistSessionCptMetadataMock).not.toHaveBeenCalled();
  });
});
