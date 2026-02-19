import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import ProgramsGoalsTab from "../ClientDetails/ProgramsGoalsTab";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showSuccess } from "../../lib/toast";
import { callApi } from "../../lib/api";

const ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";

vi.mock("../../lib/ai", async () => {
  const actual = await vi.importActual<typeof import("../../lib/ai")>("../../lib/ai");
  return {
    ...actual,
    generateProgramGoalDraft: vi.fn(),
  };
});

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
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
            id: "assessment-1",
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
});
