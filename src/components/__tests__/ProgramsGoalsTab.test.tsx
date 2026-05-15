import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import { ProgramsGoalsTab } from "../ClientDetails/ProgramsGoalsTab";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { callApi, callEdgeFunctionHttp } from "../../lib/api";
import { supabase } from "../../lib/supabase";

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

const buildStructuredGoalSections = (status: "approved" | "verified" | "drafted" = "approved") => [
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `structured-child-${index + 1}`,
    section_key: "goals_treatment_planning",
    field_key: index % 2 === 0 ? "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS" : "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
    section_index: index,
    payload: {
      title: `Child Goal ${index + 1}`,
      goal_type: "child",
      program_name: index % 2 === 0 ? "Skill Acquisition" : "Behavior Treatment",
    },
    status,
    required: true,
    review_notes: null,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `structured-parent-${index + 1}`,
    section_key: "goals_treatment_planning",
    field_key: "CALOPTIMA_FBA_PARENT_GOALS",
    section_index: index,
    payload: {
      title: `Parent Goal ${index + 1}`,
      goal_type: "parent",
      program_name: "Parent Training",
    },
    status,
    required: true,
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
    from: vi.fn(),
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

/** Deterministic, fast pointer/keyboard simulation — avoid sharing interaction state across tests. */
let user: ReturnType<typeof userEvent.setup>;

describe("ProgramsGoalsTab", { timeout: 15_000 }, () => {
  beforeEach(() => {
    user = userEvent.setup({ delay: null });

    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data:
            tableName === "programs"
              ? {
                  id: "program-1",
                  organization_id: ORG_ID,
                  client_id: "client-1",
                  name: "Communication Program",
                  status: "active",
                  created_at: "2026-02-11T00:00:00.000Z",
                  updated_at: "2026-02-11T00:00:00.000Z",
                }
              : tableName === "goals"
                ? {
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
                  }
                : {
                    id: "note-1",
                    organization_id: ORG_ID,
                    program_id: "program-1",
                    author_id: "therapist-user-id",
                    note_type: "plan_update",
                    content: { text: "note" },
                    created_at: "2026-02-11T00:00:00.000Z",
                    updated_at: "2026-02-11T00:00:00.000Z",
                  },
          error: null,
        }),
      };
      return chain as unknown as ReturnType<typeof supabase.from>;
    });

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
        return new Response(
          JSON.stringify({
            items: [],
            structured_sections: [
              ...Array.from({ length: 20 }, (_, index) => ({
                id: `structured-child-goal-${index}`,
                section_key: "goals_treatment_planning",
                field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
                section_index: index,
                payload: { title: `Child Goal ${index + 1}`, goal_type: "child" },
                status: "approved",
                required: true,
                review_notes: null,
              })),
              ...Array.from({ length: 6 }, (_, index) => ({
                id: `structured-parent-goal-${index}`,
                section_key: "goals_treatment_planning",
                field_key: "CALOPTIMA_FBA_PARENT_GOALS",
                section_index: index,
                payload: { title: `Parent Goal ${index + 1}`, goal_type: "parent" },
                status: "approved",
                required: true,
                review_notes: null,
              })),
            ],
          }),
          { status: 200 },
        );
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
      const apiPath = path.startsWith("programs")
        ? `/api/${path}`
        : path.startsWith("/api/")
          ? path
          : `/api/${path}`;
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads live programs from API route semantics and renders returned program", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(
          JSON.stringify([
            {
              id: "program-live-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              name: "Live Communication Program",
              description: "Live program from edge route",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Live Communication Program")).toBeInTheDocument();
    expect(screen.queryByText("No programs yet.")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        vi
          .mocked(callEdgeFunctionHttp)
          .mock.calls.some(
            ([path]) =>
              typeof path === "string" &&
              path.startsWith(`programs?client_id=${encodeURIComponent("client-1")}`),
          ),
      ).toBe(true);
    });
  });

  it("keeps live-load failure observable when programs edge query fails", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(JSON.stringify({ error: "edge unavailable" }), { status: 503 });
      }
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Could not load programs yet: Failed to load programs")).toBeInTheDocument();
    expect(screen.getByText("No programs yet. Create a program to unlock goals and notes for this client.")).toBeInTheDocument();
  });

  it("renders a non-blocking shell while programs are loading", async () => {
    vi.mocked(callApi).mockImplementation((path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Promise<Response>(() => {});
      }
      if (method === "GET" && path.startsWith("/api/goals?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/program-notes?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return Promise.resolve(new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 }));
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByRole("heading", { name: /Add Program/i })).toBeInTheDocument();
    expect(screen.getByText("Loading existing programs. You can still add a new program below.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Program" })).toBeInTheDocument();
  });

  it("unlocks goal and note creation after creating a program while the programs query is still loading", async () => {
    vi.mocked(callApi).mockImplementation((path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Promise<Response>(() => {});
      }
      if (method === "POST" && path === "/api/programs") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "program-pending-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              name: "Communication Program",
              description: "Created while list is pending",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            }),
            { status: 201 },
          ),
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/program-notes?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return Promise.resolve(new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 }));
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    fireEvent.change(await screen.findByPlaceholderText("Program name"), {
      target: { value: "Communication Program" },
    });
    await user.click(screen.getByRole("button", { name: "Create Program" }));

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("Program created");
    });

    fireEvent.change(screen.getByLabelText(/Goal title/i), { target: { value: "Goal A" } });
    fireEvent.change(screen.getByLabelText(/Goal description/i), { target: { value: "Goal description" } });
    fireEvent.change(screen.getByLabelText(/Original clinical wording/i), { target: { value: "Original wording" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create Goal" })).toBeEnabled();
    });

    fireEvent.change(screen.getByPlaceholderText("Add a program note"), {
      target: { value: "Progress note" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Note" })).toBeEnabled();
    });
  });

  it("creates a program and then creates a goal for the selected program", async () => {
    let hasProgram = false;
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(
          JSON.stringify(
            hasProgram
              ? [
                  {
                    id: "program-1",
                    organization_id: ORG_ID,
                    client_id: "client-1",
                    name: "Communication Program",
                    description: "Live program",
                    status: "active",
                    created_at: "2026-02-11T00:00:00.000Z",
                    updated_at: "2026-02-11T00:00:00.000Z",
                  },
                ]
              : [],
          ),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/programs") {
        hasProgram = true;
        return new Response(
          JSON.stringify({
            id: "program-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            name: "Communication Program",
            description: "Live program",
            status: "active",
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "POST" && path === "/api/goals") {
        return new Response(
          JSON.stringify({
            id: "goal-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            program_id: "program-1",
            title: "Goal A",
            description: "Goal description",
            original_text: "Original wording",
            status: "active",
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const programNameInput = await screen.findByPlaceholderText("Program name");
    fireEvent.change(programNameInput, { target: { value: "Communication Program" } });
    await user.click(screen.getByRole("button", { name: "Create Program" }));

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("Program created");
    });

    fireEvent.change(await screen.findByPlaceholderText("Goal title"), { target: { value: "Goal A" } });
    fireEvent.change(await screen.findByPlaceholderText("Goal description"), { target: { value: "Goal description" } });
    fireEvent.change(await screen.findByPlaceholderText("Original clinical wording"), { target: { value: "Original wording" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create Goal" })).toBeEnabled();
    });

    const goalFetchCountBeforeCreate = vi
      .mocked(callApi)
      .mock.calls.filter(
        ([path, init]) =>
          typeof path === "string" &&
          path.startsWith("/api/goals?") &&
          (init?.method ?? "GET").toUpperCase() === "GET",
      ).length;
    const noteFetchCountBeforeCreate = vi
      .mocked(callApi)
      .mock.calls.filter(
        ([path, init]) =>
          typeof path === "string" &&
          path.startsWith("/api/program-notes?") &&
          (init?.method ?? "GET").toUpperCase() === "GET",
      ).length;

    await user.click(screen.getByRole("button", { name: "Create Goal" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goals",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"program_id\":\"program-1\""),
        }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("Goal created");
    expect(
      vi
        .mocked(callApi)
        .mock.calls.filter(
          ([path, init]) =>
            typeof path === "string" &&
            path.startsWith("/api/goals?") &&
            (init?.method ?? "GET").toUpperCase() === "GET",
        ),
    ).toHaveLength(goalFetchCountBeforeCreate);
    expect(
      vi
        .mocked(callApi)
        .mock.calls.filter(
          ([path, init]) =>
            typeof path === "string" &&
            path.startsWith("/api/program-notes?") &&
            (init?.method ?? "GET").toUpperCase() === "GET",
        ),
    ).toHaveLength(noteFetchCountBeforeCreate);
  });

  it("renders three goal fields and serializes them into target_criteria on create", async () => {
    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    fireEvent.change(await screen.findByPlaceholderText("Program name"), {
      target: { value: "Communication Program" },
    });
    await user.click(screen.getByRole("button", { name: "Create Program" }));

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("Program created");
    });

    fireEvent.change(screen.getByPlaceholderText("Goal title"), { target: { value: "Goal A" } });
    fireEvent.change(screen.getByPlaceholderText("Goal description"), { target: { value: "Goal description" } });
    fireEvent.change(screen.getByPlaceholderText("Original clinical wording"), { target: { value: "Original wording" } });
    fireEvent.change(screen.getByPlaceholderText("Short-term goal (optional)"), {
      target: { value: "Request preferred items with a prompt." },
    });
    fireEvent.change(screen.getByPlaceholderText("Intermediate goal (optional)"), {
      target: { value: "Request preferred items across two settings." },
    });
    fireEvent.change(screen.getByPlaceholderText("Long-term goal (optional)"), {
      target: { value: "Request preferred items independently." },
    });

    await user.click(screen.getByRole("button", { name: "Create Goal" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goals",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    const createGoalCall = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.find(([path, init]) => path === "goals" && init?.method === "POST");

    expect(createGoalCall).toBeTruthy();
    const [, init] = createGoalCall!;
    const body = JSON.parse(String(init?.body)) as { target_criteria?: string };
    expect(body.target_criteria).toBe(
      "Short-term: Request preferred items with a prompt.\n" +
        "Intermediate: Request preferred items across two settings.\n" +
        "Long-term: Request preferred items independently.",
    );
  });

  it("adds a program note without refetching the notes list", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(
          JSON.stringify([
            {
              id: "program-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              name: "Communication Program",
              description: "Live program",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/program-notes?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "POST" && path === "/api/program-notes") {
        return new Response(
          JSON.stringify({
            id: "note-2",
            organization_id: ORG_ID,
            program_id: "program-1",
            author_id: "therapist-user-id",
            note_type: "plan_update",
            content: { text: "Progress note" },
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [],
            structured_sections: buildStructuredGoalSections("approved"),
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("Communication Program");

    const noteFetchCountBeforeCreate = vi
      .mocked(callApi)
      .mock.calls.filter(
        ([path, init]) =>
          typeof path === "string" &&
          path.startsWith("/api/program-notes?") &&
          (init?.method ?? "GET").toUpperCase() === "GET",
      ).length;

    fireEvent.change(await screen.findByPlaceholderText("Add a program note"), {
      target: { value: "Progress note" },
    });
    await user.click(screen.getByRole("button", { name: "Add Note" }));

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("Program note added");
    });

    expect(
      vi
        .mocked(callApi)
        .mock.calls.filter(
          ([path, init]) =>
            typeof path === "string" &&
            path.startsWith("/api/program-notes?") &&
            (init?.method ?? "GET").toUpperCase() === "GET",
        ),
    ).toHaveLength(noteFetchCountBeforeCreate);
    expect(await screen.findByText("Progress note")).toBeInTheDocument();
  });

  it("polls assessment documents only while extraction work is active", async () => {
    let assessmentFetchCount = 0;

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
        assessmentFetchCount += 1;
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "iehp_fba",
              file_name: "iehp-fba.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/iehp-fba.docx",
              status: assessmentFetchCount === 1 ? "extracting" : "drafted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText(/Extracting fields from uploaded file/i);
    await new Promise((resolve) => setTimeout(resolve, 3_300));

    await waitFor(() => {
      expect(assessmentFetchCount).toBeGreaterThanOrEqual(2);
    });

    const completedPollCount = assessmentFetchCount;
    await new Promise((resolve) => setTimeout(resolve, 3_300));
    expect(assessmentFetchCount).toBe(completedPollCount);
  });

  it("retries the assessment queue after a transient load failure", async () => {
    let assessmentFetchCount = 0;

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
        assessmentFetchCount += 1;
        if (assessmentFetchCount === 1) {
          return new Response(JSON.stringify({ error: "Temporary upstream failure" }), { status: 503 });
        }
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "iehp_fba",
              file_name: "iehp-fba.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/iehp-fba.docx",
              status: "extracting",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("No uploaded assessments yet.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 3_300));

    await waitFor(() => {
      expect(assessmentFetchCount).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByText(/Extracting fields from uploaded file/i)).toBeInTheDocument();
  });

  it("falls back to same-origin API when program edge calls time out", async () => {
    let hasProgram = false;
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockImplementation(async () => ({
          data:
            tableName === "programs" && hasProgram
              ? [
                  {
                    id: "program-fallback-1",
                    organization_id: ORG_ID,
                    client_id: "client-1",
                    name: "Fallback Program",
                    description: "Saved through Supabase fallback",
                    status: "active",
                    created_at: "2026-02-11T00:00:00.000Z",
                    updated_at: "2026-02-11T00:00:00.000Z",
                  },
                ]
              : [],
          error: null,
        })),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(async () => {
          if (tableName === "programs") {
            hasProgram = true;
            return {
              data: {
                id: "program-fallback-1",
                organization_id: ORG_ID,
                client_id: "client-1",
                name: "Fallback Program",
                description: "Saved through Supabase fallback",
                status: "active",
                created_at: "2026-02-11T00:00:00.000Z",
                updated_at: "2026-02-11T00:00:00.000Z",
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };
      return chain as unknown as ReturnType<typeof supabase.from>;
    });
    vi.mocked(callEdgeFunctionHttp).mockImplementation(async (path: string, init?: RequestInit) => {
      if (typeof path === "string" && path.startsWith("programs")) {
        return Promise.reject(new Error("Programs request timed out. Please retry."));
      }
      const callApiImpl = vi.mocked(callApi).getMockImplementation();
      if (!callApiImpl) {
        return new Response(JSON.stringify({ error: "API mock missing" }), { status: 500 });
      }
      const apiPath = path.startsWith("/api/") ? path : `/api/${path}`;
      return callApiImpl(apiPath, init);
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const programNameInput = await screen.findByPlaceholderText("Program name");
    await user.type(programNameInput, "Fallback Program");
    await user.click(screen.getByRole("button", { name: "Create Program" }));

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("Program created");
    });
    expect(await screen.findByText("Fallback Program")).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledWith("programs");
  });

  it("shows goals load error when goals edge returns non-OK", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) {
        return new Response(
          JSON.stringify([
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: ORG_ID,
              client_id: "client-1",
              name: "Live Communication Program",
              description: "Desc",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(JSON.stringify({ error: "permission denied for table goals" }), { status: 500 });
      }
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(
      await screen.findByText(/Could not load goals: permission denied for table goals/i),
    ).toBeInTheDocument();
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
    fireEvent.change(assessmentInput, {
      target: {
        value: "Assessment shows deficits in functional communication and WH-question responding with moderate prompt dependence.",
      },
    });
    await user.click(screen.getByRole("button", { name: /Generate AI Proposal Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByPlaceholderText("Program name")).toHaveValue("Communication Program");
    expect(screen.getByText(/Requesting preferred items with 2-word phrase/i)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Legacy Quick Create/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save AI Proposal to Selected Assessment/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-drafts",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("AI proposal saved to assessment queue for review.");
  });

  it("uses canonical programs array values when generating a draft proposal", async () => {
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
    await user.type(assessmentInput, "Assessment evidence supports one focused communication program and one child goal.");
    await user.click(screen.getByRole("button", { name: /Generate AI Proposal Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByPlaceholderText("Program name")).toHaveValue("Primary Program");
    expect(screen.getByText(/Draft programs: Primary Program/i)).toBeInTheDocument();
    expect(screen.getByText("Primary rationale")).toBeInTheDocument();
    expect(screen.queryByText(/Legacy Program/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy rationale")).not.toBeInTheDocument();
  });

  it("saves only canonical programs array payloads for generated drafts", async () => {
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

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const assessmentInput = await screen.findByPlaceholderText(/Paste assessment summary or White Bible-aligned notes/i);
    await user.type(
      assessmentInput,
      "Assessment evidence supports one focused communication program and one child goal.",
    );
    await user.click(screen.getByRole("button", { name: /Generate AI Proposal Program \+ Goals/i }));

    await waitFor(() => {
      expect(generateProgramGoalDraft).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: /Save AI Proposal to Selected Assessment/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith("/api/assessment-drafts", expect.objectContaining({ method: "POST" }));
    });

    const saveDraftCall = vi
      .mocked(callApi)
      .mock.calls.find(([path, init]) => path === "/api/assessment-drafts" && init?.method === "POST");
    expect(saveDraftCall).toBeDefined();
    const saveDraftPayload = JSON.parse(String(saveDraftCall?.[1]?.body));
    expect(saveDraftPayload.assessment_document_id).toBe(ASSESSMENT_ID);
    expect(saveDraftPayload.programs).toEqual([
      {
        name: "Communication Program",
        description: "Build requesting and social communication skills.",
        rationale: "Communication deficits and prompt dependence from the source assessment.",
        evidence_refs: [{ section_key: "summary", source_span: "communication deficits with prompt dependence" }],
        review_flags: [],
      },
    ]);
    expect(saveDraftPayload.summary_rationale).toBe("Derived from assessment deficits and ABA measurement guidelines.");
    expect(saveDraftPayload.confidence).toBe("medium");
    expect(Array.isArray(saveDraftPayload.goals)).toBe(true);
    expect(saveDraftPayload).not.toHaveProperty("program");
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
    await user.selectOptions(screen.getByRole("combobox", { name: /FBA template/i }), "iehp_fba");
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock iehp content"], "iehp-fba.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await user.upload(uploadInput, file);
    await user.click(screen.getByRole("button", { name: /Upload IEHP FBA/i }));
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
              extraction_error: "Previous extraction warning should not block generation.",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [],
            structured_sections: buildStructuredGoalSections("approved"),
          }),
          { status: 200 },
        );
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

    await screen.findByText("fba.docx");
    expect(await screen.findByText("Previous extraction warning should not block generation.")).toBeInTheDocument();
    const generateButton = await screen.findByRole("button", { name: /(Generate|Retry).*Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).not.toBeDisabled();
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(
        vi.mocked(callApi).mock.calls.some(
          ([path, init]) =>
            path === "/api/assessment-drafts" &&
            init?.method === "POST" &&
            JSON.parse(String(init.body)).assessment_document_id === ASSESSMENT_ID &&
            JSON.parse(String(init.body)).auto_generate === true,
        ),
      ).toBe(true);
    });
    expect(showSuccess).toHaveBeenCalledWith("Draft program and goals generated from reviewed structured FBA data.");
  });

  it("allows retry generation after extraction failure and shows retry guidance", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "failed-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/failed-fba.pdf",
              status: "extraction_failed",
              extraction_error: "Extraction failed. Review the checklist manually or upload a cleaner FBA.",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "checklist-item-1",
                section_key: "behavior_summary",
                label: "Behavior Summary",
                placeholder_key: "behavior_summary",
                required: true,
                mode: "AUTO",
                status: "verified",
                review_notes: null,
                value_text: "Aggression occurs during transitions and denied access.",
              },
            ],
            structured_sections: buildStructuredGoalSections("approved"),
          }),
          { status: 200 },
        );
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

    await screen.findByText("failed-fba.pdf");
    expect(
      await screen.findByText("Extraction failed. Review the checklist manually or upload a cleaner FBA."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Extraction failed for this assessment. Retry deterministic draft generation using the extracted checklist evidence, or replace the source document if it needs correction.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wait for extraction to complete before generating drafts.")).not.toBeInTheDocument();

    const generateButton = await screen.findByRole("button", { name: /Generate Drafts from Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).not.toBeDisabled();
    });
    await user.click(generateButton);
    await waitFor(() => {
      expect(
        vi.mocked(callApi).mock.calls.some(
          ([path, init]) =>
            path === "/api/assessment-drafts" &&
            (init?.method ?? "").toUpperCase() === "POST" &&
            JSON.parse(String(init?.body)).assessment_document_id === ASSESSMENT_ID &&
            JSON.parse(String(init?.body)).auto_generate === true,
        ),
      ).toBe(true);
    });
    expect(showSuccess).toHaveBeenCalledWith("Draft program and goals generated from reviewed structured FBA data.");
  });

  it("keeps extraction failure retry disabled when no checklist evidence is available", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "empty-failed-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/empty-failed-fba.pdf",
              status: "extraction_failed",
              extraction_error: "Extraction failed before usable checklist evidence was saved.",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify([
            {
              id: "checklist-item-empty",
              section_key: "behavior_summary",
              label: "Behavior Summary",
              placeholder_key: "behavior_summary",
              required: true,
              mode: "AUTO",
              status: "drafted",
              review_notes: null,
              value_text: "   ",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
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

    await screen.findByText("empty-failed-fba.pdf");
    expect(
      await screen.findByText(
        "Extraction failed for this assessment, but no extracted checklist evidence is available for draft generation. Replace the source document or add checklist evidence before retrying.",
      ),
    ).toBeInTheDocument();

    const generateButton = await screen.findByRole("button", { name: /Generate Drafts from Uploaded FBA/i });
    expect(generateButton).toBeDisabled();
    expect(
      vi.mocked(callApi).mock.calls.some(([path, init]) => path === "/api/assessment-drafts" && init?.method === "POST"),
    ).toBe(false);
  });

  it("shows structured goal readiness counts and blocks draft generation below minimums", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
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
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "checklist-item-1",
                section_key: "behavior_summary",
                label: "Behavior Summary",
                placeholder_key: "behavior_summary",
                required: true,
                mode: "AUTO",
                status: "drafted",
                review_notes: null,
                value_text: "Extracted behavior summary",
              },
            ],
            structured_sections: [],
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(
      await screen.findByText((_content, node) => node?.textContent === "Checklist values: 1/1"),
    ).toBeInTheDocument();
    expect(screen.getByText((_content, node) => node?.textContent === "Child goals: 0")).toBeInTheDocument();
    expect(screen.getByText((_content, node) => node?.textContent === "Parent goals: 0")).toBeInTheDocument();
    expect(screen.getByText("Approve at least one structured CalOptima goal section before generating drafts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).toBeDisabled();
  });

  it("shows extraction-failed guidance instead of generic waiting copy for uploaded assessments", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "failed-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/failed-fba.pdf",
              status: "extraction_failed",
              extraction_error: "Extraction failed. Review the checklist manually or upload a cleaner FBA.",
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

    await screen.findByText("failed-fba.pdf");
    expect(
      await screen.findByText("Extraction failed. Review the checklist manually or upload a cleaner FBA."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wait for extraction to complete before generating AI proposals.")).not.toBeInTheDocument();

    const generateButton = await screen.findByRole("button", { name: /(Generate|Retry).*Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).toBeDisabled();
    });
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
  });

  it("waits for extraction before generating staged drafts from an uploaded assessment", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "synthetic-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-fba.pdf",
              status: "extracting",
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

    const generateButton = await screen.findByRole("button", { name: /Generate Drafts from Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).toBeDisabled();
    });
    expect(await screen.findByText("Wait for extraction to complete before generating drafts.")).toBeInTheDocument();

    await user.click(generateButton);

    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
  });

  it("keeps draft generation disabled until a structured goal section is approved", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "synthetic-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-fba.pdf",
              status: "extracted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [],
            structured_sections: buildStructuredGoalSections("verified"),
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const generateButton = await screen.findByRole("button", { name: /Generate Drafts from Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).toBeDisabled();
    });
    expect(await screen.findByText("Approve at least one structured CalOptima goal section before generating drafts.")).toBeInTheDocument();
  });

  it("shows existing-draft guidance for drafted uploaded assessments", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(
          JSON.stringify([
            {
              id: ASSESSMENT_ID,
              organization_id: ORG_ID,
              client_id: "client-1",
              template_type: "caloptima_fba",
              file_name: "synthetic-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-fba.pdf",
              status: "drafted",
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
        return new Response(
          JSON.stringify({
            programs: [{ id: "draft-program-1", accept_state: "pending", name: "Draft Program" }],
            goals: [],
          }),
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

    const generateButton = await screen.findByRole("button", { name: /Generate Drafts from Uploaded FBA/i });
    await waitFor(() => {
      expect(generateButton).toBeDisabled();
    });
    expect(
      await screen.findByText("Drafts already exist for this assessment. Review/edit current drafts instead of regenerating."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wait for extraction to complete before generating drafts.")).not.toBeInTheDocument();
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
    const exportPdfButton = screen.getByRole("button", { name: /Optional: Export Completed CalOptima PDF/i });
    await waitFor(() => {
      expect(exportPdfButton).not.toBeDisabled();
    });
    await user.click(exportPdfButton);

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

  it("warns operators when generated CalOptima PDF has layout overflow warnings", async () => {
    const user = userEvent.setup();
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify({ items: [], structured_sections: [] }), { status: 200 });
      }
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
            overflow_keys: ["CALOPTIMA_FBA_CHIEF_COMPLAINT"],
            layout_warnings: [
              {
                placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
                page: 2,
                reason: "overflow",
                rendered_line_count: 3,
                total_line_count: 5,
                max_lines: 3,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("fba.pdf");
    const exportPdfButton = screen.getByRole("button", { name: /Optional: Export Completed CalOptima PDF/i });
    await waitFor(() => {
      expect(exportPdfButton).not.toBeDisabled();
    });
    await user.click(exportPdfButton);

    await waitFor(() => {
      expect(showInfo).toHaveBeenCalledWith(
        "Completed CalOptima PDF generated (overlay mode) with 1 layout warning(s). Review before sending.",
      );
    });
    expect(showSuccess).not.toHaveBeenCalledWith("Completed CalOptima PDF generated (overlay mode).");
    expect(openSpy).toHaveBeenCalledWith("https://example.com/generated-plan.pdf", "_blank", "noopener,noreferrer");
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
    const publishButton = screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i });
    await waitFor(() => {
      expect(publishButton).not.toBeDisabled();
    });
    await user.click(publishButton);

    await waitFor(() => {
      expect(showError).toHaveBeenCalled();
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("to live Programs & Goals"));
    const firstErrorArg = vi.mocked(showError).mock.calls[0]?.[0];
    expect(firstErrorArg).toBeInstanceOf(Error);
    expect((firstErrorArg as Error).message).toBe("Required checklist items must be approved before promotion.");
    confirmSpy.mockRestore();
  });

  it("shows plural publish success counts from the live-promotion response", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [
              { id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null },
              { id: "p2", name: "Program B", description: null, accept_state: "edited", review_notes: null },
            ],
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
        return new Response(JSON.stringify({ created_program_count: 2, created_goal_count: 26 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("fba.pdf");
    const publishButton = screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i });
    await waitFor(() => {
      expect(publishButton).not.toBeDisabled();
    });
    await user.click(publishButton);

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith(
        "Published to live records. Created 2 production programs and 26 goals.",
      );
    });
    confirmSpy.mockRestore();
  });

  it("shows singular publish success counts for the program label", async () => {
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
        return new Response(JSON.stringify({ created_program_count: 1, created_goal_count: 26 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("fba.pdf");
    const publishButton = screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i });
    await waitFor(() => {
      expect(publishButton).not.toBeDisabled();
    });
    await user.click(publishButton);

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith(
        "Published to live records. Created 1 production program and 26 goals.",
      );
    });
    confirmSpy.mockRestore();
  });

  it("prefers promoted draft counts over raw created-row counts in the publish success toast", async () => {
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
        return new Response(
          JSON.stringify({
            created_program_count: 1,
            created_goal_count: 27,
            promoted_program_count: 1,
            promoted_goal_count: 26,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("fba.pdf");
    const publishButton = screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i });
    await waitFor(() => {
      expect(publishButton).not.toBeDisabled();
    });
    await user.click(publishButton);

    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith(
        "Published to live records. Created 1 production program and 26 goals.",
      );
    });
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
    await user.click(await screen.findByRole("button", { name: /Save Program Draft/i }));

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

  it("hydrates legacy target criteria into the short-term goal field and saves all three goals back into target_criteria", async () => {
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
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
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
            programs: [],
            goals: [
              {
                id: "draft-goal-1",
                assessment_document_id: ASSESSMENT_ID,
                organization_id: ORG_ID,
                client_id: "client-1",
                title: "Draft Goal",
                description: "Draft goal description",
                original_text: "Draft original wording",
                goal_type: "child",
                measurement_type: "percent opportunities",
                baseline_data: "40%",
                target_criteria: "Legacy target criteria text",
                mastery_criteria: "80% across 3 sessions",
                maintenance_criteria: "70% after 4 weeks",
                generalization_criteria: "2 settings with 2 adults",
                objective_data_points: [],
                accept_state: "accepted",
                review_notes: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (method === "PATCH" && path === "/api/assessment-drafts") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    const shortTermField = await screen.findByDisplayValue("Legacy target criteria text");
    expect(shortTermField).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Intermediate goal")).toHaveValue("");
    expect(screen.getByPlaceholderText("Long-term goal")).toHaveValue("");

    fireEvent.change(screen.getByPlaceholderText("Intermediate goal"), {
      target: { value: "Intermediate draft goal" },
    });
    fireEvent.change(screen.getByPlaceholderText("Long-term goal"), {
      target: { value: "Long-term draft goal" },
    });

    await user.click(screen.getByRole("button", { name: /Save Goal Draft/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-drafts",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"draft_type\":\"goal\""),
        }),
      );
    });

    const saveGoalDraftCall = vi
      .mocked(callApi)
      .mock.calls.find(
        ([path, requestInit]) => path === "/api/assessment-drafts" && requestInit?.method === "PATCH",
      );

    expect(saveGoalDraftCall).toBeTruthy();
    const [, requestInit] = saveGoalDraftCall!;
    const body = JSON.parse(String(requestInit?.body)) as { target_criteria?: string };
    expect(body.target_criteria).toBe(
      "Short-term: Legacy target criteria text\n" +
        "Intermediate: Intermediate draft goal\n" +
        "Long-term: Long-term draft goal",
    );
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

  it("blocks publish with explicit checklist guidance when required rows are unresolved", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify([
            {
              id: "checklist-item-1",
              section_key: "assessment_summary",
              label: "Assessment summary",
              placeholder_key: "summary",
              required: true,
              mode: "ASSISTED",
              status: "verified",
              review_notes: null,
              value_text: "Synthetic assessment summary",
            },
          ]),
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
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: buildAcceptedDraftGoals(),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("1 required checklist row must be approved before publishing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i })).toBeDisabled();
  });

  it("shows approved checklist rows as locked from status downgrades", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify([
            {
              id: "checklist-item-1",
              section_key: "assessment_summary",
              label: "Assessment summary",
              placeholder_key: "summary",
              required: true,
              mode: "ASSISTED",
              status: "approved",
              review_notes: null,
              value_text: "Synthetic assessment summary",
            },
          ]),
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
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(
      await screen.findByText("Approved checklist rows stay approved; update notes or field value without lowering status."),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("approved")).toBeDisabled();
  });

  it("blocks publish while checklist review fails to load", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify({ error: "Checklist unavailable" }), { status: 500 });
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
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: buildAcceptedDraftGoals(),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(
      await screen.findByText("Checklist review failed to load. Publishing stays blocked until checklist rows can be reviewed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Checklist review must load before publishing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish to Live Programs \+ Goals/i })).toBeDisabled();
  });

  it("allows publish with smaller accepted draft sets once checklist review is complete", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path.startsWith("/api/programs?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/goals?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "checklist-item-1",
                section_key: "assessment_summary",
                label: "Assessment summary",
                placeholder_key: "summary",
                required: true,
                mode: "ASSISTED",
                status: "approved",
                review_notes: null,
                value_text: "Synthetic assessment summary",
              },
            ],
            structured_sections: [],
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
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: [
              {
                id: "child-1",
                title: "Child Goal 1",
                description: "Child goal description 1",
                original_text: "Child goal original text 1",
                goal_type: "child",
                accept_state: "accepted",
                review_notes: null,
              },
              {
                id: "child-2",
                title: "Child Goal 2",
                description: "Child goal description 2",
                original_text: "Child goal original text 2",
                goal_type: "child",
                accept_state: "accepted",
                review_notes: null,
              },
              {
                id: "parent-1",
                title: "Parent Goal 1",
                description: "Parent goal description 1",
                original_text: "Parent goal original text 1",
                goal_type: "parent",
                accept_state: "accepted",
                review_notes: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText("fba.pdf");
    const publishButton = await screen.findByRole("button", { name: /Publish to Live Programs \+ Goals/i });
    expect(publishButton).toBeEnabled();
    expect(screen.getByText("Accepted draft goals: 2 child / 1 parent")).toBeInTheDocument();
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

    const helperMessages = await screen.findAllByText("Create a program or select an existing one before adding goals or notes.");
    expect(helperMessages).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Create Goal/i })).toBeDisabled();
    expect(screen.getByLabelText(/Goal title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Goal description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Original clinical wording/i)).toBeInTheDocument();
    expect(
      screen.getByText("Paste the original clinical wording from the assessment or care-plan source so the goal stays audit-friendly."),
    ).toBeInTheDocument();
  });

  it("shows explicit no-program guidance for goals and notes", async () => {
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

    const helperMessages = await screen.findAllByText("Create a program or select an existing one before adding goals or notes.");
    expect(helperMessages).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Add Note/i })).toBeDisabled();
    expect(screen.getByPlaceholderText("Add a program note")).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: /Delete fba\.pdf/i }));

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

