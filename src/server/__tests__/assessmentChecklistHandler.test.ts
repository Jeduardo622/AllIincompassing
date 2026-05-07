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
    await expect(response.json()).resolves.toEqual({
      error: "Invalid checklist status transition: verified -> drafted",
    });
  });

  it("returns explicit guidance when approved checklist rows are downgraded", async () => {
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
          status: "approved",
        },
      ],
    });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          status: "verified",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Approved checklist rows cannot be downgraded. Edit notes or field value without lowering status.",
    });
  });

  it("allows approved checklist rows to keep approved status while updating notes and value", async () => {
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "item-1",
            assessment_document_id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "approved",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "item-1",
            status: "approved",
            review_notes: "Reviewed again",
            value_text: "Updated synthetic value",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
          review_notes: "Reviewed again",
          value_text: "Updated synthetic value",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "item-1",
      status: "approved",
      review_notes: "Reviewed again",
      value_text: "Updated synthetic value",
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_checklist_items?id=eq.item-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"approved\""),
      }),
    );
  });
});
