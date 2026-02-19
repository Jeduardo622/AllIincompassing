import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentChecklistHandler } from "../api/assessment-checklist";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    getAccessTokenSubject: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import {
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";

describe("assessmentChecklistHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("blocks backward checklist status transitions", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          id: "item-1",
          assessment_document_id: "doc-1",
          organization_id: "org-1",
          client_id: "client-1",
          status: "verified",
        },
      ],
    });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          status: "drafted",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
