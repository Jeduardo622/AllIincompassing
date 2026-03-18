import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("../runtimeConfig", () => ({
  buildSupabaseEdgeUrl: (path: string) => `https://edge.test/${path}`,
}));

const {
  callEdge: actualCallEdge,
  enqueueSessionNotesPdfExport,
  getSessionNotesPdfExportStatus,
  downloadSessionNotesPdfExport,
} = await vi.importActual<typeof import("../supabase")>("../supabase");

describe("callEdge", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getSessionMock.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses a provided bearer token without consulting the auth client", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await actualCallEdge("sessions-test", { method: "GET" }, { accessToken: "token-123" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://edge.test/sessions-test",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("attaches the anon apikey when supplied", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await actualCallEdge(
      "sessions-test",
      { method: "POST", headers: new Headers({ "Content-Type": "application/json" }) },
      { accessToken: "token-456", anonKey: "anon-key" },
    );

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-456");
    expect(headers.get("apikey")).toBe("anon-key");
  });

  it("falls back to the active session when no token is provided", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "session-token" } } });

    await actualCallEdge("sessions-test");

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer session-token");
    expect(getSessionMock).toHaveBeenCalled();
  });
});

describe("session notes pdf async edge helpers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses enqueue contract payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { exportId: "export-1", status: "queued" },
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await enqueueSessionNotesPdfExport("client-1", ["note-1"]);
    expect(result).toEqual({
      exportId: "export-1",
      status: "queued",
      error: null,
      expiresAt: null,
      pollAfterMs: undefined,
      downloadReady: false,
      isTerminal: false,
    });
  });

  it("parses status contract payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            exportId: "export-2",
            status: "ready",
            downloadReady: true,
            isTerminal: true,
            expiresAt: "2026-03-20T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getSessionNotesPdfExportStatus("export-2");
    expect(result.status).toBe("ready");
    expect(result.downloadReady).toBe(true);
    expect(result.isTerminal).toBe(true);
  });

  it("throws when enqueue response misses async contract fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { status: "queued" } }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(enqueueSessionNotesPdfExport("client-1", ["note-1"])).rejects.toThrow(
      "Invalid enqueue response contract for session notes export.",
    );
  });

  it("downloads blob from async download endpoint", async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValue(
      new Response(encoder.encode("pdf-binary"), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const blob = await downloadSessionNotesPdfExport("export-3");
    const text = await blob.text();
    expect(text).toBe("pdf-binary");
  });
});
