import { beforeEach, describe, expect, it, vi } from "vitest";
import { callEdge } from "../supabase";
import { reactivateSession } from "../sessionReactivation";

vi.mock("../supabase", () => ({
  callEdge: vi.fn(),
}));

const mockedCallEdge = vi.mocked(callEdge);

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("reactivateSession", () => {
  beforeEach(() => {
    mockedCallEdge.mockReset();
  });

  it("calls sessions-reactivate with session_id and a provided idempotency key", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        outcome: "reactivated",
        sessionId: "session-1",
      },
    }, 200, { "Idempotency-Key": "reactivate-key" }));

    const result = await reactivateSession({
      sessionId: "session-1",
      idempotencyKey: "reactivate-key",
      startTime: "2026-07-29T17:00:00.000Z",
      endTime: "2026-07-29T18:00:00.000Z",
    });

    expect(result).toEqual({
      outcome: "reactivated",
      sessionId: "session-1",
      idempotencyKey: "reactivate-key",
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-reactivate",
      expect.objectContaining({ method: "POST" }),
    );

    const requestInit = mockedCallEdge.mock.calls[0][1];
    const headers = requestInit?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBe("reactivate-key");
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      session_id: "session-1",
      start_time: "2026-07-29T17:00:00.000Z",
      end_time: "2026-07-29T18:00:00.000Z",
    });
  });

  it("generates an idempotency key when one is not supplied", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        outcome: "already_reactivated",
        sessionId: "session-1",
      },
    }));

    const result = await reactivateSession({ sessionId: "session-1" });

    expect(result).toEqual({
      outcome: "already_reactivated",
      sessionId: "session-1",
      idempotencyKey: expect.any(String),
    });
    const headers = mockedCallEdge.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("returns structured conflict outcomes instead of throwing", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({
      success: false,
      code: "THERAPIST_CONFLICT",
      error: "The original appointment time is no longer available.",
    }, 409));

    await expect(reactivateSession({ sessionId: "session-1" })).resolves.toEqual({
      outcome: "conflict",
      code: "THERAPIST_CONFLICT",
      message: "The original appointment time is no longer available.",
      idempotencyKey: expect.any(String),
    });
  });

  it("treats hold conflicts as structured slot conflicts", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({
      success: false,
      code: "HOLD_CONFLICT",
      error: "The original appointment time is no longer available.",
    }, 409));

    await expect(reactivateSession({ sessionId: "session-1" })).resolves.toEqual({
      outcome: "conflict",
      code: "HOLD_CONFLICT",
      message: "The original appointment time is no longer available.",
      idempotencyKey: expect.any(String),
    });
  });

  it("throws the server message for authorization or lifecycle errors", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({
      success: false,
      code: "AUTHORIZATION_INVALID",
      error: "Linked authorization is no longer valid.",
    }, 409));

    await expect(reactivateSession({ sessionId: "session-1" })).rejects.toThrow(
      "Linked authorization is no longer valid.",
    );
  });

  it("rejects partial windows before calling the edge function", async () => {
    await expect(
      reactivateSession({
        sessionId: "session-1",
        startTime: "2026-07-29T17:00:00.000Z",
      }),
    ).rejects.toThrow("startTime and endTime must be provided together");

    expect(mockedCallEdge).not.toHaveBeenCalled();
  });
});
