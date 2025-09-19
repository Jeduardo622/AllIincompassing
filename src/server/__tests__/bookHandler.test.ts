import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookHandler } from "../api/book";
import { bookSession } from "../bookSession";

vi.mock("../bookSession", () => ({
  bookSession: vi.fn(),
}));

const mockedBookSession = vi.mocked(bookSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bookHandler", () => {
  it("returns CORS headers for OPTIONS requests", async () => {
    const response = await bookHandler(new Request("http://localhost/api/book", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects non-POST methods", async () => {
    const response = await bookHandler(new Request("http://localhost/api/book", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("returns error when JSON payload is invalid", async () => {
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: "not-json",
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          therapist_id: "therapist-1",
          client_id: "client-1",
          start_time: "2025-01-01T10:00:00Z",
          end_time: "2025-01-01T11:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
      }),
    }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/authorization/i);
    expect(mockedBookSession).not.toHaveBeenCalled();
  });

  it("invokes booking service and returns success", async () => {
    mockedBookSession.mockResolvedValueOnce({
      session: {
        id: "session-1",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      hold: { holdKey: "hold", holdId: "1", expiresAt: "2025-01-01T10:05:00Z" },
      cpt: { code: "97153", description: "Adaptive behavior treatment by protocol", modifiers: [], source: "fallback", durationMinutes: 60 },
    });

    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "abc-123",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        session: {
          therapist_id: "therapist-1",
          client_id: "client-1",
          start_time: "2025-01-01T10:00:00Z",
          end_time: "2025-01-01T11:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe("abc-123");
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-1");
    expect(mockedBookSession).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "abc-123",
      accessToken: "valid-token",
    }));
  });

  it("surfaces booking errors", async () => {
    mockedBookSession.mockRejectedValueOnce(new Error("conflict"));

    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        session: {
          therapist_id: "therapist-1",
          client_id: "client-1",
          start_time: "2025-01-01T10:00:00Z",
          end_time: "2025-01-01T11:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
      }),
    }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("conflict");
    expect(mockedBookSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "valid-token" }));
  });
});
