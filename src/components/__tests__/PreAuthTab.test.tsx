import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import { PreAuthTab } from "../ClientDetails/PreAuthTab";
import { createAuthorizationWithServices, updateAuthorizationDocuments } from "../../lib/authorizations/mutations";
import { showSuccess } from "../../lib/toast";

const ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";

const {
  createAuthorizationWithServicesMock,
  updateAuthorizationDocumentsMock,
  storageUploadMock,
  supabaseFromMock,
  useAuthMock,
  useActiveOrganizationIdMock,
} = vi.hoisted(() => {
  const createAuthorizationWithServicesMock = vi.fn();
  const updateAuthorizationDocumentsMock = vi.fn();
  const storageUploadMock = vi.fn();
  const useAuthMock = vi.fn();
  const useActiveOrganizationIdMock = vi.fn();

  const createEqQuery = (data: unknown[]) => {
    const query = {
      eq: vi.fn(() => query),
      then: (resolve: (value: { data: unknown[]; error: null }) => void, reject: (reason?: unknown) => void) =>
        Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return query;
  };

  const supabaseFromMock = vi.fn((table: string) => {
    if (table === "cpt_codes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() =>
              Promise.resolve({
                data: [{ code: "97153", short_description: "Adaptive behavior treatment by protocol" }],
                error: null,
              }),
            ),
          })),
        })),
      };
    }

    if (table === "insurance_providers") {
      return {
        select: vi.fn(() => ({
          order: vi.fn(() =>
            Promise.resolve({
              data: [{ id: "payer-1", name: "IEHP" }],
              error: null,
            }),
          ),
        })),
      };
    }

    if (table === "therapists") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() =>
                Promise.resolve({
                  data: [{ id: "therapist-provider-1", full_name: "Provider Therapist" }],
                  error: null,
                }),
              ),
            })),
          })),
        })),
      };
    }

    if (table === "clients") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { therapist_id: "therapist-provider-1" },
                  error: null,
                }),
              ),
            })),
          })),
        })),
      };
    }

    if (table === "client_therapist_links") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                data: [{ therapist_id: "therapist-provider-1" }],
                error: null,
              }),
            ),
          })),
        })),
      };
    }

    if (table === "client_session_notes" || table === "authorizations") {
      return {
        select: vi.fn(() => createEqQuery([])),
      };
    }

    return {
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
  });

  return {
    createAuthorizationWithServicesMock,
    updateAuthorizationDocumentsMock,
    storageUploadMock,
    supabaseFromMock,
    useAuthMock,
    useActiveOrganizationIdMock,
  };
});

vi.mock("../../lib/authContext", () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => useActiveOrganizationIdMock(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: supabaseFromMock,
    storage: {
      from: vi.fn(() => ({
        upload: storageUploadMock,
      })),
    },
  },
}));

vi.mock("../../lib/authorizations/mutations", () => ({
  createAuthorizationWithServices: createAuthorizationWithServicesMock,
  updateAuthorizationDocuments: updateAuthorizationDocumentsMock,
}));

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

describe("PreAuthTab manual authorization upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "admin-user-id" } });
    useActiveOrganizationIdMock.mockReturnValue(ORG_ID);
    createAuthorizationWithServicesMock.mockResolvedValue({ id: "auth-created-id" });
    updateAuthorizationDocumentsMock.mockResolvedValue(undefined);
    storageUploadMock.mockResolvedValue({ error: null });
  });

  it("creates an authorization from entered notice fields and attaches the uploaded PDF", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));

    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.type(screen.getByLabelText(/authorization number/i), "IEHP-AUTH-123");
    await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
    await waitFor(() => {
      expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
    });
    await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");
    await user.type(screen.getByLabelText(/member id/i), "MEM-123");
    await user.type(screen.getByLabelText(/start date/i), "2026-06-23");
    await user.type(screen.getByLabelText(/end date/i), "2026-12-22");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(await screen.findByLabelText(/97153/i));

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.type(screen.getByLabelText(/units requested/i), "120");

    await user.click(screen.getByRole("button", { name: /next/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["synthetic authorization notice"], "auth-notice.pdf", {
      type: "application/pdf",
    });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(createAuthorizationWithServices).toHaveBeenCalledWith(
        expect.objectContaining({
          authorization_number: "IEHP-AUTH-123",
          client_id: "client-1",
          provider_id: "therapist-provider-1",
          insurance_provider_id: "payer-1",
          plan_type: "Medicaid",
          member_id: "MEM-123",
          diagnosis_code: "F84.0",
          diagnosis_description: "Autistic disorder",
          start_date: "2026-06-23",
          end_date: "2026-12-22",
          status: "approved",
          services: [
            expect.objectContaining({
              service_code: "97153",
              service_description: "Adaptive behavior treatment by protocol",
              from_date: "2026-06-23",
              to_date: "2026-12-22",
              requested_units: 120,
              approved_units: 120,
              unit_type: "Units",
              decision_status: "approved",
            }),
          ],
        }),
      );
    });

    expect(storageUploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^clients\/client-1\/authorizations\/auth-created-id\/.+\.pdf$/),
      file,
      { upsert: false },
    );
    expect(updateAuthorizationDocuments).toHaveBeenCalledWith({
      authorization_id: "auth-created-id",
      documents: [
        expect.objectContaining({
          name: "auth-notice.pdf",
          path: expect.stringMatching(/^clients\/client-1\/authorizations\/auth-created-id\/.+\.pdf$/),
          type: "application/pdf",
        }),
      ],
    });
    expect(showSuccess).toHaveBeenCalledWith("Authorization uploaded and saved.");
  });
});
