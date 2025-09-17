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
            totalCount: 3,
            cancelledSessionIds: ["s1", "s2"],
            alreadyCancelledSessionIds: ["s3"],
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
      totalCount: 3,
      cancelledSessionIds: ["s1", "s2"],
      alreadyCancelledSessionIds: ["s3"],
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
            totalCount: 0,
            cancelledSessionIds: [],
            alreadyCancelledSessionIds: [],
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
});
