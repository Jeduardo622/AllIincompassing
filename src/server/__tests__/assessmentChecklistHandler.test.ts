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
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
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

  it("blocks approving blank required checklist placeholders", async () => {
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
          status: "drafted",
          required: true,
          placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
          label: "Reason for Referral",
          value_text: "",
          value_json: null,
        },
      ],
    });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Required checklist item Reason for Referral cannot be approved while blank.",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("blocks blanking an already approved required checklist row when status is omitted", async () => {
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
          required: true,
          placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
          label: "Reason for Referral",
          value_text: "951-555-0101",
          value_json: null,
        },
      ],
    });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          value_text: "",
          value_json: null,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Required checklist item Reason for Referral cannot be approved while blank.",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("allows approving blank optional IEHP checklist rows even when stored required metadata is stale", async () => {
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
            status: "drafted",
            required: true,
            placeholder_key: "IEHP_FBA_REFERRING_PROVIDER",
            label: "Name of Referring Provider, Credentials",
            value_text: "",
            value_json: null,
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "item-1", status: "approved" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          item_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "item-1", status: "approved" });
  });

  it("returns checklist rows with structured sections", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
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
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "item-1" }] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "section-1", status: "drafted" }] });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist?assessment_document_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: "item-1" }],
      structured_sections: [{ id: "section-1", status: "drafted" }],
    });
  });

  it("recomputes IEHP skills_behaviors on GET when stored summary payload is stale", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
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
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "item-1" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "section-summary",
            field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
            section_index: 0,
            payload: {
              targets: ["Waiting"],
              skills_behaviors: {
                version: 1,
                items: [],
                counts: { total: 0, behavior: 0, skill: 0, summary_only: 0, detailed_only: 0, ambiguous: 0 },
              },
            },
          },
          {
            id: "section-detail",
            field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
            section_index: 1,
            payload: {
              program_name: "Waiting",
              clinical_goal_type: "skill",
              goal_type: "child",
            },
          },
        ],
      });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist?assessment_document_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: "item-1" }],
      structured_sections: [
        {
          id: "section-summary",
          field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
          section_index: 0,
          payload: {
            targets: ["Waiting"],
            skills_behaviors: {
              version: 1,
              items: [
                {
                  name: "Waiting",
                  clinical_goal_type: "skill",
                  reconciliation_status: "matched",
                  summary_target_index: 0,
                  matched_goal_refs: [
                    {
                      field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
                      section_index: 1,
                    },
                  ],
                  classification_source: "explicit_goal_type",
                },
              ],
              counts: {
                total: 1,
                behavior: 0,
                skill: 1,
                summary_only: 0,
                detailed_only: 0,
                ambiguous: 0,
              },
            },
          },
        },
        {
          id: "section-detail",
          field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
          section_index: 1,
          payload: {
            program_name: "Waiting",
            clinical_goal_type: "skill",
            goal_type: "child",
          },
        },
      ],
    });
  });

  it("updates structured sections including rejected status and records review events", async () => {
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
            id: "section-1",
            assessment_document_id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "section-1", status: "rejected" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          status: "rejected",
          review_notes: "Needs correction",
          payload: { title: "Goal" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_structured_sections?id=eq.section-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"rejected\""),
      }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_review_events"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"item_type\":\"structured_section\""),
      }),
    );
  });

  it("strips client-supplied skills_behaviors from summary payload PATCH updates", async () => {
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
            id: "section-1",
            assessment_document_id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
            payload: {
              targets: ["Waiting"],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "section-1",
            status: "drafted",
            payload: {
              targets: ["Waiting", "Functional Communication"],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          payload: {
            targets: ["Waiting", "Functional Communication"],
            skills_behaviors: {
              version: 1,
              items: [{ name: "forged" }],
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_structured_sections?id=eq.section-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"targets\":[\"Waiting\",\"Functional Communication\"]"),
      }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_structured_sections?id=eq.section-1"),
      expect.not.objectContaining({
        body: expect.stringContaining("skills_behaviors"),
      }),
    );
  });

  it("blocks approving blank required structured template placeholders", async () => {
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
          id: "section-1",
          assessment_document_id: "doc-1",
          organization_id: "org-1",
          client_id: "client-1",
          status: "drafted",
          required: true,
          field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
          payload: {
            field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
            label: "Reason for Referral",
            template_placeholder: true,
            entered_value_present: false,
            clinical_value: null,
            raw_text: "",
          },
        },
      ],
    });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Required structured section IEHP_FBA_REASON_FOR_REFERRAL cannot be approved while blank.",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("allows approving blank optional IEHP structured placeholders even when stored required metadata is stale", async () => {
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
            id: "section-1",
            assessment_document_id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            required: true,
            field_key: "IEHP_FBA_REFERRING_PROVIDER",
            payload: {
              field_key: "IEHP_FBA_REFERRING_PROVIDER",
              label: "Name of Referring Provider, Credentials",
              template_placeholder: true,
              entered_value_present: false,
              clinical_value: null,
              raw_text: "",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "section-1", status: "approved" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "section-1", status: "approved" });
  });

  it("allows approving filled structured placeholders even when extraction flags are stale", async () => {
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
            id: "section-1",
            assessment_document_id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            required: true,
            field_key: "IEHP_FBA_REFERRING_PROVIDER",
            payload: {
              field_key: "IEHP_FBA_REFERRING_PROVIDER",
              label: "Name of Referring Provider, Credentials",
              template_placeholder: true,
              entered_value_present: false,
              clinical_value: "",
              raw_text: "Dr. Jane Referrer, MD",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "section-1", status: "approved" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentChecklistHandler(
      new Request("http://localhost/api/assessment-checklist", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "section-1", status: "approved" });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_structured_sections?id=eq.section-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"approved\""),
      }),
    );
  });

  it("blocks payload edits on approved structured sections", async () => {
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
          id: "section-1",
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
          structured_section_id: "11111111-1111-1111-1111-111111111111",
          payload: { title: "Unreviewed edit" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Approved structured section payloads are locked. Reject and recreate a reviewed section before changing clinical content.",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
