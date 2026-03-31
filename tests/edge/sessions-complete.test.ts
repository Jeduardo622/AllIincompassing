// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";

// vi.mock is hoisted — these run before any imports.
vi.mock("../../supabase/functions/_shared/database.ts", () => ({
  createRequestClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../../supabase/functions/_shared/audit.ts", () => ({
  recordSessionAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/_shared/metrics.ts", () => ({
  increment: vi.fn(),
}));

import * as database from "../../supabase/functions/_shared/database.ts";
import { __TESTING__ } from "../../supabase/functions/sessions-complete/index.ts";

const { handleSessionCompletion, parseCompletionPayload } = __TESTING__;

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

const makeSelectBuilder = (sessions: unknown[]) => {
  const builder: any = {};
  const chain = () => builder;
  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.in = vi.fn(() => chain());
  builder.limit = vi.fn(() => chain());
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: sessions, error: null });
  return builder;
};

const makeUpdateBuilder = (updatedRow: Record<string, unknown> | null) => {
  const builder: any = {};
  const chain = () => builder;
  builder.update = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.in = vi.fn(() => chain());
  builder.select = vi.fn(() => chain());
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: updatedRow ? [updatedRow] : [], error: null });
  return builder;
};

const createStubLogger = () => {
  const stub: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: vi.fn().mockImplementation(() => stub),
  };
  return stub;
};

const makeSession = (overrides: Partial<{
  id: string;
  status: string;
  therapist_id: string | null;
  start_time: string;
  end_time: string;
}> = {}) => ({
  id: "session-1",
  status: "scheduled",
  therapist_id: "therapist-1",
  start_time: "2026-03-31T09:00:00Z",
  end_time: "2026-03-31T10:00:00Z",
  ...overrides,
});

const makeDb = () => ({ rpc: vi.fn(async () => ({ error: null })) } as any);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sessions-complete handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a scheduled session as completed (authorized admin)", async () => {
    const session = makeSession({ id: "session-1", status: "scheduled" });
    const updatedRow = { id: "session-1", status: "completed", updated_at: "2026-03-31T10:05:00Z" };

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUpdateBuilder(updatedRow),
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-1", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; data: { outcome: string; session: Record<string, unknown> } };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe("completed");
    expect(body.data.session.id).toBe("session-1");
  });

  it("marks an in_progress session as no-show (authorized admin)", async () => {
    const session = makeSession({ id: "session-2", status: "in_progress" });
    const updatedRow = { id: "session-2", status: "no-show", updated_at: "2026-03-31T10:05:00Z" };

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUpdateBuilder(updatedRow),
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-2", outcome: "no-show", notes: "Client did not attend" },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; data: { outcome: string } };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe("no-show");
  });

  it("allows a therapist to complete their own session", async () => {
    const session = makeSession({ id: "session-3", status: "scheduled", therapist_id: "therapist-1" });
    const updatedRow = { id: "session-3", status: "completed", updated_at: "2026-03-31T10:05:00Z" };

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUpdateBuilder(updatedRow),
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-3", outcome: "completed", notes: null },
      "therapist-1",
      "therapist",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("denies a therapist completing another therapist's session (403 FORBIDDEN)", async () => {
    const session = makeSession({ id: "session-4", status: "scheduled", therapist_id: "therapist-owner" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-4", outcome: "completed", notes: null },
      "therapist-interloper",
      "therapist",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("rejects a session that is already completed (409 ALREADY_TERMINAL)", async () => {
    const session = makeSession({ id: "session-5", status: "completed" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-5", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe("ALREADY_TERMINAL");
  });

  it("rejects a session that is already cancelled (409 ALREADY_TERMINAL)", async () => {
    const session = makeSession({ id: "session-6", status: "cancelled" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-6", outcome: "no-show", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.code).toBe("ALREADY_TERMINAL");
  });

  it("rejects a session that is already a no-show (409 ALREADY_TERMINAL)", async () => {
    const session = makeSession({ id: "session-7", status: "no-show" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-7", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.code).toBe("ALREADY_TERMINAL");
  });

  it("returns 409 CONCURRENT_MODIFICATION when UPDATE affects zero rows", async () => {
    const session = makeSession({ id: "session-8", status: "scheduled" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    // Simulate a concurrent modification: UPDATE returns empty rows
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUpdateBuilder(null),
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-8", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe("CONCURRENT_MODIFICATION");
  });

  it("returns 404 when the session is not found in the org scope", async () => {
    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-nonexistent", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// parseCompletionPayload unit tests
// ---------------------------------------------------------------------------

describe("parseCompletionPayload", () => {
  it("parses a valid completed payload", () => {
    const result = parseCompletionPayload({ session_id: "abc-123", outcome: "completed", notes: "All good" });
    expect(result).toEqual({ session_id: "abc-123", outcome: "completed", notes: "All good" });
  });

  it("parses a valid no-show payload without notes", () => {
    const result = parseCompletionPayload({ session_id: "def-456", outcome: "no-show" });
    expect(result).toEqual({ session_id: "def-456", outcome: "no-show", notes: null });
  });

  it("coerces blank notes to null", () => {
    const result = parseCompletionPayload({ session_id: "ghi-789", outcome: "completed", notes: "   " });
    expect(result.notes).toBeNull();
  });

  it("throws BadRequestError when session_id is missing", () => {
    expect(() => parseCompletionPayload({ outcome: "completed" })).toThrow("Missing required field: session_id");
  });

  it("throws BadRequestError when outcome is invalid", () => {
    expect(() => parseCompletionPayload({ session_id: "xyz", outcome: "cancelled" })).toThrow(
      'outcome must be "completed" or "no-show"',
    );
  });

  it("throws BadRequestError when payload is not an object", () => {
    expect(() => parseCompletionPayload("bad")).toThrow("Invalid request payload");
  });
});
