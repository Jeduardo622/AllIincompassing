import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com,https://preview.example.com"],
  ["APP_ENV", "production"],
]);

stubDenoEnv((key) => envValues.get(key) ?? "");

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const currentUserCanManageProgramsGoalsMock = vi.fn();
const orgScopedQueryMock = vi.fn();

async function loadProgramNotesModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    requireOrg: requireOrgMock,
    currentUserCanManageProgramsGoals: currentUserCanManageProgramsGoalsMock,
    orgScopedQuery: orgScopedQueryMock,
  }));
  return import("../../supabase/functions/program-notes/index.ts");
}

function configureProgramNotesGetSuccessDb() {
  createRequestClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "therapist-1" } }, error: null })),
    },
  });
  requireOrgMock.mockResolvedValue("org-1");
  currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
  orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
    if (table !== "program_notes") {
      throw new Error(`Unexpected table lookup: ${table}`);
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [{ id: "note-1" }], error: null })),
        })),
      })),
    };
  });
}

describe("program-notes route CORS contract", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    currentUserCanManageProgramsGoalsMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it("includes request-scoped CORS headers on allowed-origin GET success", async () => {
    configureProgramNotesGetSuccessDb();
    const module = await loadProgramNotesModule();

    const response = await module.handleProgramNotes(
      new Request("https://edge.example.com/functions/v1/program-notes?program_id=11111111-1111-4111-8111-111111111111", {
        method: "GET",
        headers: {
          Origin: "https://preview.example.com",
          Authorization: "Bearer token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.com");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("keeps OPTIONS preflight behavior unchanged for program-notes route", async () => {
    const module = await loadProgramNotesModule();

    const response = await module.default(
      new Request("https://edge.example.com/functions/v1/program-notes?program_id=11111111-1111-4111-8111-111111111111", {
        method: "OPTIONS",
        headers: {
          Origin: "https://preview.example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.com");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("allows midtier through the handler role gate when the capability helper allows program-goal management", async () => {
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: [{ id: "note-1" }], error: null })),
      })),
    }));
    const db = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "midtier-1" } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table !== "program_notes") {
          throw new Error(`Unexpected table insert: ${table}`);
        }
        return { insert: insertMock };
      }),
    };
    createRequestClientMock.mockReturnValue(db);
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table === "programs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [{ id: "program-1" }], error: null })),
            })),
          })),
        };
      }
      if (table === "program_notes") {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table lookup: ${table}`);
    });
    const module = await loadProgramNotesModule();

    const response = await module.handleProgramNotes(
      new Request("https://edge.example.com/functions/v1/program-notes", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          program_id: "11111111-1111-4111-8111-111111111111",
          note_type: "other",
          content: { text: "Midtier note" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(currentUserCanManageProgramsGoalsMock).toHaveBeenCalledWith(db, "org-1");
    expect(insertMock).toHaveBeenCalledWith([{
      organization_id: "org-1",
      program_id: "11111111-1111-4111-8111-111111111111",
      note_type: "other",
      content: { text: "Midtier note" },
      author_id: "midtier-1",
    }]);
  });

  it.each([["admin_schedule"], ["bt"]])("denies %s when the capability helper rejects program-goal management", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "denied-user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(false);
    const module = await loadProgramNotesModule();

    const response = await module.handleProgramNotes(
      new Request("https://edge.example.com/functions/v1/program-notes", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          program_id: "11111111-1111-4111-8111-111111111111",
          note_type: "other",
          content: { text: "Denied note" },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(orgScopedQueryMock).not.toHaveBeenCalled();
  });
});
