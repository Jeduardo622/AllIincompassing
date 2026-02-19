import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import ProgramsGoalsTab from "../ClientDetails/ProgramsGoalsTab";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showInfo, showSuccess } from "../../lib/toast";
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

  it("generates program/goals draft and creates all draft records", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /Generate Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByPlaceholderText("Program name")).toHaveValue("Communication Program");
    expect(screen.getByText(/Requesting preferred items with 2-word phrase/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Legacy Quick Create/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/programs",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const goalPostCalls = vi.mocked(callApi).mock.calls.filter(
      (call) => call[0] === "/api/goals" && (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(goalPostCalls).toHaveLength(2);
    expect(showSuccess).toHaveBeenCalledWith("Created 1 program and 2 goals from assessment draft.");
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

    await screen.findByText(/Assessment Upload/i);
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
    await userEvent.click(screen.getByRole("button", { name: /Generate Completed CalOptima PDF/i }));

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
});
