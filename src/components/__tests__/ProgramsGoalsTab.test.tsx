import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import ProgramsGoalsTab from "../ClientDetails/ProgramsGoalsTab";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { callApi } from "../../lib/api";

const ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../../lib/ai", async () => {
  const actual = await vi.importActual<typeof import("../../lib/ai")>("../../lib/ai");
  return {
    ...actual,
    generateProgramGoalDraft: vi.fn(),
  };
});

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  callApi: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

describe("ProgramsGoalsTab", () => {
  beforeEach(() => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/program-notes?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      if (method === "POST" && path === "/api/programs") {
        return new Response(
          JSON.stringify({
            id: "program-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            name: "Communication Program",
            status: "active",
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "POST" && path === "/api/goals") {
        return new Response(
          JSON.stringify({
            id: "goal-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            program_id: "program-1",
            title: "Goal",
            description: "Goal description",
            original_text: "Original wording",
            status: "active",
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "POST" && path === "/api/assessment-documents") {
        return new Response(
          JSON.stringify({
            id: ASSESSMENT_ID,
            organization_id: ORG_ID,
            client_id: "client-1",
            template_type: "iehp_fba",
            file_name: "iehp-fba.docx",
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            file_size: 1000,
            bucket_id: "client-documents",
            object_path: "clients/client-1/assessments/iehp-fba.docx",
            status: "uploaded",
            created_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "POST" && path === "/api/assessment-plan-pdf") {
        return new Response(
          JSON.stringify({
            fill_mode: "overlay",
            signed_url: "https://example.com/generated-plan.pdf",
            object_path: "clients/client-1/assessments/generated.pdf",
          }),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-drafts") {
        return new Response(
          JSON.stringify({
            draft_program_id: "draft-program-1",
          }),
          { status: 201 },
        );
      }

      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    vi.mocked(generateProgramGoalDraft).mockResolvedValue({
      program: {
        name: "Communication Program",
        description: "Build requesting and social communication skills.",
      },
      goals: [
        {
          title: "Requesting preferred items with 2-word phrase",
          description: "Client requests preferred items in natural environment opportunities.",
          original_text: "Client will request preferred items using a 2-word phrase.",
        },
        {
          title: "Answering simple WH questions",
          description: "Client answers WH questions with visual support.",
          original_text: "Client will answer who/what/where questions with 80% accuracy.",
        },
      ],
      rationale: "Derived from assessment deficits and ABA measurement guidelines.",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates program/goals proposal and saves it for review", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.pdf",
              status: "extracted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-drafts") {
        return new Response(JSON.stringify({ draft_program_id: "draft-program-1" }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    const assessmentInput = await screen.findByPlaceholderText(
      /Paste assessment summary or White Bible-aligned notes/i,
    );
    await userEvent.type(
      assessmentInput,
      "Assessment shows deficits in functional communication and WH-question responding with moderate prompt dependence.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Generate AI Proposal Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByPlaceholderText("Program name")).toHaveValue("Communication Program");
    expect(screen.getByText(/Requesting preferred items with 2-word phrase/i)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Legacy Quick Create/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save AI Proposal to Selected Assessment/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-drafts",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("AI proposal saved to assessment queue for review.");
  });

  it("uploads IEHP assessment with selected template type", async () => {
    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText(/FBA Upload \+ AI Workflow/i);
    await userEvent.selectOptions(screen.getByDisplayValue("CalOptima FBA"), "iehp_fba");
    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(uploadInput).not.toBeNull();
    const file = new File(["mock iehp content"], "iehp-fba.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await userEvent.upload(uploadInput as HTMLInputElement, file);
    await userEvent.click(screen.getByRole("button", { name: /Upload IEHP FBA/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-documents",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"template_type\":\"iehp_fba\""),
        }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("IEHP FBA uploaded and checklist initialized.");
  });

  it("generates staged drafts from selected uploaded assessment", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/program-notes?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "fba.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.docx",
              status: "extracted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      if (method === "POST" && path === "/api/assessment-drafts") {
        return new Response(JSON.stringify({ draft_program_id: "draft-program-1", auto_generated: true }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    const generateButton = await screen.findByRole("button", { name: /Generate with AI from Uploaded FBA/i });
    await userEvent.click(generateButton);

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-drafts",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"auto_generate\":true"),
        }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("AI proposal program and goals generated from uploaded FBA.");
  });

  it("generates completed CalOptima PDF for selected assessment", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.pdf",
              status: "uploaded",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-plan-pdf") {
        return new Response(
          JSON.stringify({
            fill_mode: "overlay",
            signed_url: "https://example.com/generated-plan.pdf",
            object_path: "clients/client-1/assessments/generated.pdf",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("fba.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Optional: Export Completed CalOptima PDF/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-plan-pdf",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(openSpy).toHaveBeenCalledWith("https://example.com/generated-plan.pdf", "_blank", "noopener,noreferrer");
    expect(showSuccess).toHaveBeenCalledWith("Completed CalOptima PDF generated (overlay mode).");
    openSpy.mockRestore();
  });

  it("resets stale selected assessment when client queue changes", async () => {
    const assessmentIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const assessmentIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.includes("assessment_document_id=")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?client_id=client-a")) {
        return new Response(
          JSON.stringify([
            {
              id: assessmentIdA,
              organization_id: ORG_ID,
              client_id: "client-a",
              template_type: "caloptima_fba",
              file_name: "a-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-a/assessments/a-fba.pdf",
              status: "uploaded",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?client_id=client-b")) {
        return new Response(
          JSON.stringify([
            {
              id: assessmentIdB,
              organization_id: ORG_ID,
              client_id: "client-b",
              template_type: "caloptima_fba",
              file_name: "b-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-b/assessments/b-fba.pdf",
              status: "uploaded",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const { rerender } = renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-a",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("a-fba.pdf");
    await waitFor(() => {
      expect(
        vi.mocked(callApi).mock.calls.some(
          ([path]) => typeof path === "string" && path.includes(`assessment_document_id=${assessmentIdA}`),
        ),
      ).toBe(true);
    });

    const callsBeforeRerender = vi.mocked(callApi).mock.calls.length;

    rerender(
      <ProgramsGoalsTab
        client={
          {
            id: "client-b",
            email: "client@example.com",
            full_name: "Client Two",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
    );

    await screen.findByText("b-fba.pdf");
    await waitFor(() => {
      const newCalls = vi.mocked(callApi).mock.calls.slice(callsBeforeRerender);
      expect(
        newCalls.some(([path]) => typeof path === "string" && path.includes(`assessment_document_id=${assessmentIdB}`)),
      ).toBe(true);
      expect(
        newCalls.some(([path]) => typeof path === "string" && path.includes(`assessment_document_id=${assessmentIdA}`)),
      ).toBe(false);
    });
    expect(showInfo).toHaveBeenCalledWith("Assessment selection was updated to match this client's available queue.");
  });

  it("shows promote precondition API error details", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: [
              {
                id: "g1",
                title: "Goal A",
                description: "Goal description",
                original_text: "Goal original text",
                accept_state: "accepted",
                review_notes: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.pdf",
              status: "drafted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-promote") {
        return new Response(JSON.stringify({ error: "Required checklist items must be approved before promotion." }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("fba.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Publish Approved Programs \+ Goals/i }));

    await waitFor(() => {
      expect(showError).toHaveBeenCalled();
    });
    const firstErrorArg = vi.mocked(showError).mock.calls[0]?.[0];
    expect(firstErrorArg).toBeInstanceOf(Error);
    expect((firstErrorArg as Error).message).toBe("Required checklist items must be approved before promotion.");
  });

  it("shows inline helper when promote is disabled", async () => {
    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    expect(await screen.findByText("Select a valid assessment first.")).toBeInTheDocument();
  });

  it("deletes an uploaded assessment document from the queue", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.pdf",
              status: "uploaded",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "DELETE" && path.startsWith("/api/assessment-documents?assessment_document_id=")) {
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(
      <ProgramsGoalsTab
        client={
          {
            id: "client-1",
            email: "client@example.com",
            full_name: "Client One",
            date_of_birth: "2017-05-01",
            insurance_info: {},
            service_preference: [],
            one_to_one_units: 0,
            supervision_units: 0,
            parent_consult_units: 0,
            assessment_units: 0,
            availability_hours: {},
            created_at: "2026-02-11T00:00:00.000Z",
          } as any
        }
      />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("fba.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Delete fba\.pdf/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        `/api/assessment-documents?assessment_document_id=${encodeURIComponent(ASSESSMENT_ID)}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("Deleted fba.pdf.");
    confirmSpy.mockRestore();
  });
});
