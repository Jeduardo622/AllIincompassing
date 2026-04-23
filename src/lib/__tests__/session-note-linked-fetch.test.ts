import { afterEach, describe, expect, it, vi } from "vitest";
import { isMissingColumnSelectError } from "../session-note-linked-fetch";

const { maybeSingleMock, fromMock } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const from = vi.fn(() => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: maybeSingle,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return chain;
  });
  return { maybeSingleMock: maybeSingle, fromMock: from };
});

vi.mock("../supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

describe("isMissingColumnSelectError", () => {
  it("returns true for Postgres undefined_column code", () => {
    expect(
      isMissingColumnSelectError({ code: "42703", message: 'column "goal_measurements" does not exist' }),
    ).toBe(true);
  });

  it("returns true when message names goal_measurements and missing column", () => {
    expect(
      isMissingColumnSelectError({
        code: "PGRST204",
        message: "Could not find the 'goal_measurements' column of 'client_session_notes' in the schema cache",
      }),
    ).toBe(true);
  });

  it("returns true when missing-column text is in details", () => {
    expect(
      isMissingColumnSelectError({
        code: "PGRST204",
        details: "Could not find the 'goal_measurements' column in the schema cache",
      }),
    ).toBe(true);
  });

  it("returns true for code-only PGRST204 errors", () => {
    expect(isMissingColumnSelectError({ code: "PGRST204" })).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isMissingColumnSelectError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumnSelectError(null)).toBe(false);
  });
});

describe("fetchLinkedClientSessionNoteForSession", () => {
  afterEach(() => {
    maybeSingleMock.mockReset();
    fromMock.mockClear();
    vi.resetModules();
  });

  it("returns row when full select succeeds", async () => {
    const row = {
      id: "n1",
      authorization_id: "a1",
      service_code: "97151",
      narrative: null,
      goal_notes: {},
      goal_measurements: { g: {} },
      goal_ids: [],
      goals_addressed: [],
    };
    maybeSingleMock.mockResolvedValueOnce({ data: row, error: null });
    const { fetchLinkedClientSessionNoteForSession } = await import("../session-note-linked-fetch");
    const result = await fetchLinkedClientSessionNoteForSession({
      sessionId: "sess-1",
      organizationId: "org-1",
    });
    expect(result).toEqual(row);
    expect(fromMock).toHaveBeenCalledWith("client_session_notes");
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });

  it("retries without goal_measurements when first select fails on missing column", async () => {
    const baseRow = {
      id: "n1",
      authorization_id: "a1",
      service_code: "97151",
      narrative: null,
      goal_notes: {},
      goal_ids: [] as string[] | null,
      goals_addressed: [] as string[] | null,
    };
    maybeSingleMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "42703",
          message: 'column "goal_measurements" does not exist',
        },
      })
      .mockResolvedValueOnce({ data: baseRow, error: null });

    const { fetchLinkedClientSessionNoteForSession } = await import("../session-note-linked-fetch");
    const result = await fetchLinkedClientSessionNoteForSession({
      sessionId: "sess-1",
      organizationId: "org-1",
    });

    expect(maybeSingleMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...baseRow, goal_measurements: null });
  });

  it("retries without goal_measurements for code-only PGRST204 errors", async () => {
    const baseRow = {
      id: "n1",
      authorization_id: "a1",
      service_code: "97151",
      narrative: null,
      goal_notes: {},
      goal_ids: [] as string[] | null,
      goals_addressed: [] as string[] | null,
    };
    maybeSingleMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
        },
      })
      .mockResolvedValueOnce({ data: baseRow, error: null });

    const { fetchLinkedClientSessionNoteForSession } = await import("../session-note-linked-fetch");
    const result = await fetchLinkedClientSessionNoteForSession({
      sessionId: "sess-1",
      organizationId: "org-1",
    });

    expect(maybeSingleMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...baseRow, goal_measurements: null });
  });

  it("throws when full select fails with a non-schema error", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const { fetchLinkedClientSessionNoteForSession } = await import("../session-note-linked-fetch");
    await expect(
      fetchLinkedClientSessionNoteForSession({ sessionId: "sess-1", organizationId: "org-1" }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });
});
