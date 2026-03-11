import { describe, it, expect, vi, beforeEach } from "vitest";
import { cancelSessions } from "../sessionCancellation";
import { callEdge } from "../supabase";

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

describe("cancelSessions", () => {
  beforeEach(() => {
    mockedCallEdge.mockReset();
  });

  it("cancels sessions by id and returns summary", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          data: {
            cancelledCount: 2,
            alreadyCancelledCount: 1,
            nonCancellableCount: 1,
            totalCount: 3,
            cancelledSessionIds: ["s1", "s2"],
            alreadyCancelledSessionIds: ["s3"],
            nonCancellableSessionIds: ["s4"],
          },
        },
        200,
        { "Idempotency-Key": "custom-key" },
      ),
    );

    const result = await cancelSessions({
      sessionIds: ["s1", "s2"],
      idempotencyKey: "custom-key",
    });

    expect(result).toEqual({
      cancelledCount: 2,
      alreadyCancelledCount: 1,
      nonCancellableCount: 1,
      totalCount: 3,
      cancelledSessionIds: ["s1", "s2"],
      alreadyCancelledSessionIds: ["s3"],
      nonCancellableSessionIds: ["s4"],
      idempotencyKey: "custom-key",
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-cancel",
      expect.objectContaining({ method: "POST" }),
    );

    const requestInit = mockedCallEdge.mock.calls[0][1];
    const headers = requestInit?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBe("custom-key");

    const body = JSON.parse(requestInit?.body as string);
    expect(body.session_ids).toEqual(["s1", "s2"]);
  });

  it("generates an idempotency key when not provided", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          data: {
            cancelledCount: 0,
            alreadyCancelledCount: 0,
            nonCancellableCount: 0,
            totalCount: 0,
            cancelledSessionIds: [],
            alreadyCancelledSessionIds: [],
            nonCancellableSessionIds: [],
          },
        },
        200,
        {},
      ),
    );

    await cancelSessions({ date: "2025-03-18" });

    const requestInit = mockedCallEdge.mock.calls[0][1];
    const headers = requestInit?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    const body = JSON.parse(requestInit?.body as string);
    expect(body.date).toBe("2025-03-18");
  });

  it("throws when the API responds with an error", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "bad request" }, 400),
    );

    await expect(cancelSessions({ sessionIds: ["s1"] })).rejects.toThrow(
      /bad request/i,
    );
  });

  it("parses non-cancellable session metadata from snake_case payloads", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse(
        {
          success: true,
          data: {
            cancelled_count: 1,
            already_cancelled_count: 1,
            non_cancellable_count: 2,
            total_count: 4,
            cancelled_session_ids: ["s1"],
            already_cancelled_session_ids: ["s2"],
            non_cancellable_session_ids: ["s3", "s4"],
          },
        },
        200,
      ),
    );

    const result = await cancelSessions({ sessionIds: ["s1", "s2", "s3", "s4"] });

    expect(result).toEqual({
      cancelledCount: 1,
      alreadyCancelledCount: 1,
      nonCancellableCount: 2,
      totalCount: 4,
      cancelledSessionIds: ["s1"],
      alreadyCancelledSessionIds: ["s2"],
      nonCancellableSessionIds: ["s3", "s4"],
      idempotencyKey: expect.any(String),
    });
  });

  it("throws when cancellation is forbidden", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Forbidden" }, 403),
    );

    await expect(cancelSessions({ sessionIds: ["s1"] })).rejects.toThrow(
      /forbidden/i,
    );
  });
});
