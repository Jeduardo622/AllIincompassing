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
  extractPdfTextMock,
  MockPdfTextExtractionError,
  cptCodesMockData,
  cptCodesQueryMock,
} = vi.hoisted(() => {
  const createAuthorizationWithServicesMock = vi.fn();
  const updateAuthorizationDocumentsMock = vi.fn();
  const storageUploadMock = vi.fn();
  const useAuthMock = vi.fn();
  const useActiveOrganizationIdMock = vi.fn();
  const extractPdfTextMock = vi.fn();
  const cptCodesMockData = [{ code: "97153", short_description: "Adaptive behavior treatment by protocol" }];
  const cptCodesQueryMock = vi.fn(() =>
    Promise.resolve({
      data: cptCodesMockData,
      error: null,
    }),
  );
  class MockPdfTextExtractionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PdfTextExtractionError";
    }
  }

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
            order: cptCodesQueryMock,
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
    extractPdfTextMock,
    MockPdfTextExtractionError,
    cptCodesMockData,
    cptCodesQueryMock,
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

vi.mock("../../lib/authorizations/pdfText", () => ({
  extractPdfText: extractPdfTextMock,
  PdfTextExtractionError: MockPdfTextExtractionError,
}));

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe("PreAuthTab manual authorization upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "admin-user-id" } });
    useActiveOrganizationIdMock.mockReturnValue(ORG_ID);
    createAuthorizationWithServicesMock.mockResolvedValue({ id: "auth-created-id" });
    updateAuthorizationDocumentsMock.mockResolvedValue(undefined);
    storageUploadMock.mockResolvedValue({ error: null });
    extractPdfTextMock.mockResolvedValue("");
    cptCodesMockData.splice(0, cptCodesMockData.length, {
      code: "97153",
      short_description: "Adaptive behavior treatment by protocol",
    });
    cptCodesQueryMock.mockImplementation(() =>
      Promise.resolve({
        data: cptCodesMockData,
        error: null,
      }),
    );
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

  it("prefills empty wizard fields from an uploaded PDF and submits extracted values", async () => {
    extractPdfTextMock.mockResolvedValue(`
      Authorization Number: IEHP-PDF-456
      Decision: pending
      Member ID: MEM-PDF-456
      Diagnosis: F84.0 - Autistic disorder
      Service From: 07/01/2026 to 12/31/2026
      97153 requested units: 96 approved units: 88
    `);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));

    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
    await waitFor(() => {
      expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
    });
    await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["synthetic authorization notice"], "auth-notice.pdf", {
      type: "application/pdf",
    });
    await user.upload(fileInput, file);

    expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();
    expect(screen.getByText(/review extracted fields before submitting/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(createAuthorizationWithServices).toHaveBeenCalledWith(
        expect.objectContaining({
          authorization_number: "IEHP-PDF-456",
          member_id: "MEM-PDF-456",
          start_date: "2026-07-01",
          end_date: "2026-12-31",
          status: "pending",
          services: [
            expect.objectContaining({
              service_code: "97153",
              requested_units: 88,
              approved_units: null,
              decision_status: "pending",
            }),
          ],
        }),
      );
    });
  });

  it("does not overwrite admin-entered notice fields during PDF prefill", async () => {
    extractPdfTextMock.mockResolvedValue(`
      Authorization Number: IEHP-PDF-999
      Decision: approved
      Member ID: MEM-PDF-999
      Service From: 08/01/2026 to 09/30/2026
      97153 approved units: 40
    `);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));

    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.type(screen.getByLabelText(/authorization number/i), "ADMIN-AUTH-1");
    await user.selectOptions(screen.getByLabelText(/authorization status/i), "denied");
    await user.type(screen.getByLabelText(/start date/i), "2026-06-01");
    await user.type(screen.getByLabelText(/end date/i), "2026-06-30");
    await user.type(screen.getByLabelText(/member id/i), "ADMIN-MEMBER-1");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "auth-notice.pdf", {
        type: "application/pdf",
      }),
    );

    expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByLabelText(/authorization number/i)).toHaveValue("ADMIN-AUTH-1");
    expect(screen.getByLabelText(/authorization status/i)).toHaveValue("denied");
    expect(screen.getByLabelText(/start date/i)).toHaveValue("2026-06-01");
    expect(screen.getByLabelText(/end date/i)).toHaveValue("2026-06-30");
    expect(screen.getByLabelText(/member id/i)).toHaveValue("ADMIN-MEMBER-1");
  });

  it("keeps manual submission usable and shows manual-entry status when PDF text is unavailable", async () => {
    extractPdfTextMock.mockRejectedValue(new MockPdfTextExtractionError("No embedded PDF text was found."));
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));

    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.type(screen.getByLabelText(/authorization number/i), "MANUAL-AUTH-1");
    await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
    await waitFor(() => {
      expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
    });
    await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");
    await user.type(screen.getByLabelText(/member id/i), "MANUAL-MEMBER-1");
    await user.type(screen.getByLabelText(/start date/i), "2026-06-23");
    await user.type(screen.getByLabelText(/end date/i), "2026-12-22");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(await screen.findByLabelText(/97153/i));

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.type(screen.getByLabelText(/units requested/i), "120");

    await user.click(screen.getByRole("button", { name: /next/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "scanned-auth-notice.pdf", {
        type: "application/pdf",
      }),
    );

    expect(await screen.findByText(/No embedded PDF text was found/i)).toBeInTheDocument();
    expect(screen.getByText(/manual entry remains available/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(createAuthorizationWithServices).toHaveBeenCalledWith(
        expect.objectContaining({
          authorization_number: "MANUAL-AUTH-1",
          member_id: "MANUAL-MEMBER-1",
          status: "approved",
        }),
      );
    });
  });

  it("skips unsupported PDF service codes and shows them in the status banner", async () => {
    extractPdfTextMock.mockResolvedValue(`
      Authorization Number: IEHP-PDF-777
      Service From: 07/01/2026 to 12/31/2026
      97153 approved units: 20
      H2019 approved units: 10
    `);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));
    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "auth-notice.pdf", {
        type: "application/pdf",
      }),
    );

    expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();
    expect(screen.getByText(/Unsupported service codes skipped: H2019/i)).toBeInTheDocument();
  });

  it("uses the latest admin status edit when delayed PDF prefill resolves", async () => {
    const deferredText = createDeferred<string>();
    extractPdfTextMock.mockReturnValueOnce(deferredText.promise);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));
    await screen.findByRole("heading", { name: /authorization notice details/i });

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "auth-notice.pdf", {
        type: "application/pdf",
      }),
    );
    expect(await screen.findByText(/Extracting authorization PDF/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.selectOptions(screen.getByLabelText(/authorization status/i), "denied");

    deferredText.resolve(`
      Authorization Number: IEHP-DELAYED-1
      Decision: approved
      Service From: 07/01/2026 to 12/31/2026
      97153 approved units: 24
    `);

    await waitFor(() => {
      expect(screen.getByLabelText(/authorization number/i)).toHaveValue("IEHP-DELAYED-1");
      expect(screen.getByLabelText(/authorization status/i)).toHaveValue("denied");
    });
  });

  it("ignores delayed PDF prefill after the wizard is cancelled and reopened", async () => {
    const deferredText = createDeferred<string>();
    extractPdfTextMock.mockReturnValueOnce(deferredText.promise);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));
    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "stale-auth-notice.pdf", {
        type: "application/pdf",
      }),
    );
    expect(await screen.findByText(/Extracting authorization PDF/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /new authorization/i }));

    deferredText.resolve(`
      Authorization Number: STALE-AUTH-999
      Decision: denied
      Member ID: STALE-MEMBER
      Service From: 07/01/2026 to 12/31/2026
      97153 approved units: 24
    `);

    await screen.findByRole("heading", { name: /authorization notice details/i });
    await waitFor(() => {
      expect(screen.getByLabelText(/authorization number/i)).toHaveValue("");
    });
    expect(screen.getByLabelText(/authorization status/i)).toHaveValue("approved");
    expect(screen.queryByText(/PDF prefill applied/i)).not.toBeInTheDocument();
  });

  it("preserves the uploaded file while delayed PDF prefill resolves", async () => {
    const deferredText = createDeferred<string>();
    extractPdfTextMock.mockReturnValueOnce(deferredText.promise);
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));
    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
    await waitFor(() => {
      expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
    });
    await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["synthetic authorization notice"], "delayed-auth-notice.pdf", {
      type: "application/pdf",
    });
    await user.upload(fileInput, file);

    deferredText.resolve(`
      Authorization Number: IEHP-DELAYED-2
      Decision: approved
      Member ID: MEM-DELAYED-2
      Diagnosis: F84.0 - Autistic disorder
      Service From: 07/01/2026 to 12/31/2026
      97153 approved units: 24
    `);

    expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(storageUploadMock).toHaveBeenCalledWith(
        expect.stringMatching(/^clients\/client-1\/authorizations\/auth-created-id\/.+\.pdf$/),
        file,
        { upsert: false },
      );
    });
  });

  it("uses CPT codes loaded during delayed PDF extraction for service prefill", async () => {
    const deferredText = createDeferred<string>();
    const deferredCptCodes = createDeferred<Array<{ code: string; short_description: string }>>();
    cptCodesQueryMock.mockReturnValueOnce(deferredCptCodes.promise.then((data) => ({ data, error: null })));
    extractPdfTextMock.mockReturnValueOnce(deferredText.promise);
    let resolvedPdfTextDuringCatalogRender = false;
    const catalogCode = {
      code: "97155",
      get short_description() {
        if (!resolvedPdfTextDuringCatalogRender) {
          resolvedPdfTextDuringCatalogRender = true;
          deferredText.resolve(`
            Authorization Number: IEHP-CATALOG-1
            Decision: approved
            Service From: 07/01/2026 to 12/31/2026
            97155 approved units: 32
          `);
        }

        return "Adaptive behavior treatment with protocol modification";
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

    await user.click(screen.getByRole("button", { name: /new authorization/i }));
    await screen.findByRole("heading", { name: /authorization notice details/i });
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(/Loading CPT codes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["synthetic authorization notice"], "catalog-refresh-auth-notice.pdf", {
        type: "application/pdf",
      }),
    );
    expect(await screen.findByText(/Extracting authorization PDF/i)).toBeInTheDocument();

    deferredCptCodes.resolve([catalogCode]);

    expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();
    expect(resolvedPdfTextDuringCatalogRender).toBe(true);
    expect(screen.queryByText(/Unsupported service codes skipped: 97155/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText(/units requested/i)).toHaveValue(32);
  });
});
