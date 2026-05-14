import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com,https://preview.example.com"],
  ["APP_ENV", "production"],
]);

stubDenoEnv((key) => envValues.get(key) ?? "");

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const orgScopedQueryMock = vi.fn();

async function loadProgramNotesModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    requireOrg: requireOrgMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
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
  assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "therapist");
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
    assertUserHasOrgRoleMock.mockReset();
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
});
