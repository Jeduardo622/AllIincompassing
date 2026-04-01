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

const { handleSessionCompletion, parseCompletionPayload, checkSessionNotesPresent } = __TESTING__;

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
    // No session_goals → notes check skipped; notes table not needed.
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeSelectBuilder([]);
      return makeUpdateBuilder(updatedRow);
    });

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

// ---------------------------------------------------------------------------
// checkSessionNotesPresent unit tests
// ---------------------------------------------------------------------------

describe("checkSessionNotesPresent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: make an admin select builder that resolves to specific rows.
  const makeAdminSelect = (rows: unknown[]) => {
    const builder: any = {};
    const chain = () => builder;
    builder.select = vi.fn(() => chain());
    builder.eq = vi.fn(() => chain());
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return builder;
  };

  it("returns null (passes) when there are no session_goals", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeAdminSelect([]);
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).toBeNull();
  });

  it("returns 409 SESSION_NOTES_REQUIRED when there are session_goals but no note row", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeAdminSelect([{ goal_id: "goal-1" }]);
      if (table === "client_session_notes") return makeAdminSelect([]);
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).not.toBeNull();
    const body = await result!.json() as { success: boolean; code: string; missing_goal_count: number };
    expect(result!.status).toBe(409);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
    expect(body.missing_goal_count).toBe(1);
  });

  it("returns 409 SESSION_NOTES_REQUIRED when a note row exists but goal_notes is missing an entry for one goal", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") {
        return makeAdminSelect([{ goal_id: "goal-1" }, { goal_id: "goal-2" }]);
      }
      if (table === "client_session_notes") {
        // goal-1 covered, goal-2 missing
        return makeAdminSelect([{ goal_notes: { "goal-1": "Good progress." } }]);
      }
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).not.toBeNull();
    const body = await result!.json() as { success: boolean; code: string; missing_goal_count: number };
    expect(result!.status).toBe(409);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
    expect(body.missing_goal_count).toBe(1);
  });

  it("returns 409 SESSION_NOTES_REQUIRED when goal_notes entry is an empty string", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeAdminSelect([{ goal_id: "goal-1" }]);
      if (table === "client_session_notes") {
        return makeAdminSelect([{ goal_notes: { "goal-1": "   " } }]);
      }
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).not.toBeNull();
    const body = await result!.json() as { success: boolean; code: string };
    expect(result!.status).toBe(409);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
  });

  it("returns null (passes) when all session_goals have non-empty goal_notes entries", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") {
        return makeAdminSelect([{ goal_id: "goal-1" }, { goal_id: "goal-2" }]);
      }
      if (table === "client_session_notes") {
        return makeAdminSelect([
          { goal_notes: { "goal-1": "Excellent progress.", "goal-2": "Needed prompting." } },
        ]);
      }
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).toBeNull();
  });

  it("returns null (passes) when goal_notes are spread across multiple note rows", async () => {
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") {
        return makeAdminSelect([{ goal_id: "goal-1" }, { goal_id: "goal-2" }]);
      }
      if (table === "client_session_notes") {
        // Two separate note rows, each covering one goal.
        return makeAdminSelect([
          { goal_notes: { "goal-1": "Great." } },
          { goal_notes: { "goal-2": "Progressing." } },
        ]);
      }
      return makeAdminSelect([]);
    });

    const result = await checkSessionNotesPresent("session-1", "org-1", createStubLogger());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SESSION_NOTES_REQUIRED surface-through tests (handleSessionCompletion)
// ---------------------------------------------------------------------------

describe("sessions-complete handler — SESSION_NOTES_REQUIRED guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeAdminSelect = (rows: unknown[]) => {
    const builder: any = {};
    const chain = () => builder;
    builder.select = vi.fn(() => chain());
    builder.eq = vi.fn(() => chain());
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return builder;
  };

  it("rejects an in_progress session when no linked note exists (409 SESSION_NOTES_REQUIRED)", async () => {
    const session = makeSession({ id: "session-notes-1", status: "in_progress" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeAdminSelect([{ goal_id: "goal-a" }]);
      if (table === "client_session_notes") return makeAdminSelect([]);
      return makeAdminSelect([]);
    });

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-notes-1", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
  });

  it("rejects an in_progress session when some goal_notes entries are missing (409 SESSION_NOTES_REQUIRED)", async () => {
    const session = makeSession({ id: "session-notes-2", status: "in_progress" });

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") {
        return makeAdminSelect([{ goal_id: "goal-a" }, { goal_id: "goal-b" }]);
      }
      if (table === "client_session_notes") {
        return makeAdminSelect([{ goal_notes: { "goal-a": "Covered." } }]);
      }
      return makeAdminSelect([]);
    });

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-notes-2", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; code: string };
    expect(response.status).toBe(409);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
  });

  it("allows an in_progress session when all session_goals have non-empty goal_notes", async () => {
    const session = makeSession({ id: "session-notes-3", status: "in_progress" });
    const updatedRow = { id: "session-notes-3", status: "completed", updated_at: "2026-03-31T11:00:00Z" };

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "session_goals") return makeAdminSelect([{ goal_id: "goal-a" }]);
      if (table === "client_session_notes") {
        return makeAdminSelect([{ goal_notes: { "goal-a": "Client met target." } }]);
      }
      // UPDATE call (sessions table)
      return makeUpdateBuilder(updatedRow);
    });

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-notes-3", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean; data: { outcome: string } };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe("completed");
  });

  it("skips the notes guard for a scheduled session (no notes required)", async () => {
    const session = makeSession({ id: "session-notes-4", status: "scheduled" });
    const updatedRow = { id: "session-notes-4", status: "completed", updated_at: "2026-03-31T11:00:00Z" };

    vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(
      makeSelectBuilder([session]) as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );
    // UPDATE mock only — notes guard should never call supabaseAdmin.from
    (database.supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUpdateBuilder(updatedRow),
    );

    const response = await handleSessionCompletion(
      makeDb(),
      "org-1",
      { session_id: "session-notes-4", outcome: "completed", notes: null },
      "admin-user",
      "admin",
      createStubLogger(),
    );

    const body = await response.json() as { success: boolean };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
