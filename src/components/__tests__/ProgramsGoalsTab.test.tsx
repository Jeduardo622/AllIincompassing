import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import { ProgramsGoalsTab } from "../ClientDetails/ProgramsGoalsTab";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { callApi, callEdgeFunctionHttp } from "../../lib/api";

const ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
type ProgramsGoalsTabClient = React.ComponentProps<typeof ProgramsGoalsTab>["client"];

const buildClient = (overrides: Partial<ProgramsGoalsTabClient> = {}): ProgramsGoalsTabClient => ({
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
  auth_units: 0,
  availability_hours: {},
  created_at: "2026-02-11T00:00:00.000Z",
  ...overrides,
});

const buildAcceptedDraftGoals = () => [
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `child-${index + 1}`,
    title: `Child Goal ${index + 1}`,
    description: `Child goal description ${index + 1}`,
    original_text: `Child goal original text ${index + 1}`,
    goal_type: "child" as const,
    accept_state: "accepted" as const,
    review_notes: null,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `parent-${index + 1}`,
    title: `Parent Goal ${index + 1}`,
    description: `Parent goal description ${index + 1}`,
    original_text: `Parent goal original text ${index + 1}`,
    goal_type: "parent" as const,
    accept_state: "accepted" as const,
    review_notes: null,
  })),
];

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
  callEdgeFunctionHttp: vi.fn(),
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
    vi.mocked(callEdgeFunctionHttp).mockImplementation(async (path: string, init?: RequestInit) => {
      const apiPath = path.startsWith("/api/") ? path : `/api/${path}`;
      const callApiImpl = vi.mocked(callApi).getMockImplementation();
      if (!callApiImpl) {
        return new Response(JSON.stringify({ error: "API mock missing" }), { status: 500 });
      }
      return callApiImpl(apiPath, init);
    });

    vi.mocked(generateProgramGoalDraft).mockResolvedValue({
      programs: [
        {
          name: "Communication Program",
          description: "Build requesting and social communication skills.",
          rationale: "Communication deficits and prompt dependence from the source assessment.",
          evidence_refs: [{ section_key: "summary", source_span: "communication deficits with prompt dependence" }],
          review_flags: [],
        },
      ],
      goals: [
        {
          program_name: "Communication Program",
          title: "Requesting preferred items with 2-word phrase",
          description: "Client requests preferred items in natural environment opportunities.",
          original_text: "Client will request preferred items using a 2-word phrase.",
          goal_type: "child",
          target_behavior: "functional requesting",
          measurement_type: "percent opportunities",
          baseline_data: "40% with full prompt",
          target_criteria: "80% with gestural prompt",
          mastery_criteria: "80% across 3 sessions",
          maintenance_criteria: "70% after 4 weeks",
          generalization_criteria: "2 settings with 2 adults",
          objective_data_points: ["independent request count", "prompt level"],
          rationale: "Aligned to communication deficits noted in FBA",
          evidence_refs: [{ section_key: "goals", source_span: "requesting deficits" }],
          review_flags: [],
        },
        {
          program_name: "Communication Program",
          title: "Answering simple WH questions",
          description: "Client answers WH questions with visual support.",
          original_text: "Client will answer who/what/where questions with 80% accuracy.",
          goal_type: "child",
          target_behavior: "responding to WH questions",
          measurement_type: "percent correct",
          baseline_data: "35% correct with model prompts",
          target_criteria: "80% correct with visual cue only",
          mastery_criteria: "80% across 3 sessions",
          maintenance_criteria: "75% after 4 weeks",
          generalization_criteria: "2 settings and 2 communication partners",
          objective_data_points: ["correct response count", "prompt level"],
          rationale: "Supported by deficits in receptive language skills",
          evidence_refs: [{ section_key: "language", source_span: "WH-question deficits" }],
          review_flags: [],
        },
      ],
      summary_rationale: "Derived from assessment deficits and ABA measurement guidelines.",
      confidence: "medium",
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
      <ProgramsGoalsTab client={buildClient()} />,
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
  }, 15000);

  it("prioritizes programs array over legacy program fallback", async () => {
    vi.mocked(generateProgramGoalDraft).mockResolvedValueOnce({
      programs: [
        {
          name: "Primary Program",
          description: "Primary programs[] entry",
          rationale: "Primary response shape",
          evidence_refs: [{ section_key: "summary", source_span: "primary shape evidence" }],
          review_flags: [],
        },
      ],
      goals: [
        {
          program_name: "Primary Program",
          title: "Primary goal title",
          description: "Primary goal description",
          original_text: "Primary original text",
          goal_type: "child",
          target_behavior: "requesting",
          measurement_type: "percent opportunities",
          baseline_data: "30%",
          target_criteria: "80%",
          mastery_criteria: "80% across 3 sessions",
          maintenance_criteria: "70% at 1 month",
          generalization_criteria: "2 settings and 2 adults",
          objective_data_points: ["independent responses"],
          rationale: "primary rationale",
          evidence_refs: [{ section_key: "goals", source_span: "primary goal evidence" }],
          review_flags: [],
        },
      ],
      summary_rationale: "Primary rationale",
      confidence: "medium",
      // Transitional fixture for compatibility guardrail validation.
      // programs[] must remain the source of truth while this exists.
      ...( {
        program: {
          name: "Legacy Program",
          description: "Legacy fallback shape",
        },
        rationale: "Legacy rationale",
      } as Record<string, unknown>),
    } as unknown as Awaited<ReturnType<typeof generateProgramGoalDraft>>);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const assessmentInput = await screen.findByPlaceholderText(/Paste assessment summary or White Bible-aligned notes/i);
    await userEvent.type(assessmentInput, "Assessment evidence supports one focused communication program and one child goal.");
    await userEvent.click(screen.getByRole("button", { name: /Generate AI Proposal Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByPlaceholderText("Program name")).toHaveValue("Primary Program");
    expect(screen.getByText(/Draft programs: Primary Program/i)).toBeInTheDocument();
    expect(screen.queryByText(/Legacy Program/i)).not.toBeInTheDocument();
  });

  it("uploads IEHP assessment with selected template type", async () => {
    const baseCallApiImpl = vi.mocked(callApi).getMockImplementation();
    if (!baseCallApiImpl) {
      throw new Error("Missing base API mock implementation.");
    }
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && path === "/api/assessment-documents") {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return baseCallApiImpl(path, init);
    });

    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
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
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock iehp content"], "iehp-fba.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await userEvent.upload(uploadInput, file);
    await userEvent.click(screen.getByRole("button", { name: /Upload IEHP FBA/i }));
    await screen.findByText(/Uploading and processing your FBA/i);
    expect(screen.getByRole("button", { name: /Uploading and processing/i })).toBeDisabled();

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-documents",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"template_type\":\"iehp_fba\""),
        }),
      );
    });
    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("IEHP FBA uploaded and checklist initialized.");
    });
  });

  it("limits accepted upload types to pdf and docx", async () => {
    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText(/FBA Upload \+ AI Workflow/i);
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    expect(uploadInput.getAttribute("accept")).toBe(".pdf,.docx");
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
      <ProgramsGoalsTab client={buildClient()} />,
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
      <ProgramsGoalsTab client={buildClient()} />,
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

  it("shows a visible extracting indicator for assessment processing", async () => {
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
              status: "extracting",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("fba.pdf");
    expect(screen.getByText(/Extracting fields from uploaded file/i)).toBeInTheDocument();
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
      <ProgramsGoalsTab client={buildClient({ id: "client-a" })} />,
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
      <ProgramsGoalsTab client={buildClient({ id: "client-b", full_name: "Client Two" })} />,
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
            goals: buildAcceptedDraftGoals(),
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

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("fba.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i }));

    await waitFor(() => {
      expect(showError).toHaveBeenCalled();
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("to live Programs & Goals"));
    const firstErrorArg = vi.mocked(showError).mock.calls[0]?.[0];
    expect(firstErrorArg).toBeInstanceOf(Error);
    expect((firstErrorArg as Error).message).toBe("Required checklist items must be approved before promotion.");
    confirmSpy.mockRestore();
  });

  it("shows draft-vs-live status messaging in review panel", async () => {
    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    expect(await screen.findByText("All changes published.")).toBeInTheDocument();
    expect(screen.getByText("Publishing makes accepted drafts live in Programs and Goals.")).toBeInTheDocument();
  });

  it("saves a program draft and shows draft-only messaging", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
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
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [
              {
                id: "draft-program-1",
                assessment_document_id: ASSESSMENT_ID,
                organization_id: ORG_ID,
                client_id: "client-1",
                name: "Draft Program",
                description: "Initial draft",
                accept_state: "accepted",
                review_notes: null,
              },
            ],
            goals: [],
          }),
          { status: 200 },
        );
      }
      if (method === "PATCH" && path === "/api/assessment-drafts") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("Draft changes pending publication.");
    await userEvent.click(await screen.findByRole("button", { name: /Save Program Draft/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-drafts",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"draft_type\":\"program\""),
        }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("Program draft saved. Not published yet.");
    expect(screen.getByText("Saves to draft only. Not visible in live records until published.")).toBeInTheDocument();
  });

  it("shows inline helper when promote is disabled", async () => {
    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
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

  it("shows add-goal prerequisites when create goal is disabled", async () => {
    renderWithProviders(
      <ProgramsGoalsTab client={buildClient()} />,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    expect(await screen.findByText("Create or select a program first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Goal/i })).toBeDisabled();
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
      <ProgramsGoalsTab client={buildClient()} />,
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

