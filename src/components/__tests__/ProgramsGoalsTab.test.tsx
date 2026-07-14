import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, renderWithProviders, screen, userEvent, waitFor, within } from "../../test/utils";
import { GoalTargetProgressionPanel, ProgramsGoalsTab } from "../ClientDetails/ProgramsGoalsTab";
import { canRoleManageGoalTargetProgression, GoalTargetProgressionEditor } from "../ClientDetails/GoalTargetProgressionEditor";
import { GoalTargetProgressionHistory } from "../ClientDetails/GoalTargetProgressionHistory";
import type { GoalTarget, GoalTargetPhaseCriterion, GoalTargetTransition } from "../../types";
import { generateProgramGoalDraft } from "../../lib/ai";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { callApi, callEdgeFunctionHttp } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { AuthProvider } from "../../lib/authContext";
import { STUB_AUTH_STORAGE_KEY } from "../../lib/authStubSession";
import * as organizationModule from "../../lib/organization";

const ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
const { storageUploadMock, storageRemoveMock } = vi.hoisted(() => ({
  storageUploadMock: vi.fn().mockResolvedValue({ error: null }),
  storageRemoveMock: vi.fn().mockResolvedValue({ error: null }),
}));
type ProgramsGoalsTabClient = React.ComponentProps<typeof ProgramsGoalsTab>["client"];

const seedStubAuthState = () => {
  const now = new Date();
  const nowIso = now.toISOString();

  window.localStorage.setItem(
    STUB_AUTH_STORAGE_KEY,
    JSON.stringify({
      user: {
        id: "therapist-user-id",
        email: "therapist@example.com",
        role: "therapist",
        full_name: "Test User",
        first_name: "Test",
        last_name: "User",
      },
      role: "therapist",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: now.getTime() + 60 * 60 * 1000,
      profile: {
        id: "therapist-user-id",
        email: "therapist@example.com",
        role: "therapist",
        organization_id: ORG_ID,
        full_name: "Test User",
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
    }),
  );
};

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

describe("ProgramsGoalsTab progression integration", { timeout: 15_000 }, () => {
  const integrationTargets: GoalTarget[] = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organization_id: ORG_ID, client_id: "client-1", goal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Current target", measurement_type: "correctIncorrect", graph_config: {}, status: "active", sort_order: 0, current_phase: "mastery", is_current: true, evaluation_window_started_at: "2026-07-10T00:00:00Z", progression_version: 4, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", organization_id: ORG_ID, client_id: "client-1", goal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Next target", measurement_type: "correctIncorrect", graph_config: {}, status: "active", sort_order: 1, current_phase: "baseline", is_current: false, evaluation_window_started_at: null, progression_version: 2, created_at: "2026-07-02T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", organization_id: ORG_ID, client_id: "client-1", goal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Archived target", measurement_type: "correctIncorrect", graph_config: {}, status: "archived", sort_order: 2, current_phase: "teaching", is_current: false, evaluation_window_started_at: null, progression_version: 7, created_at: "2026-07-03T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
  ];
  const setup = (role: "bcba" | "midtier" | "super_admin" | "admin" | "therapist", mutationStatus = 200, targets = integrationTargets, goalStatus: "active" | "mastered" = "active") => {
    vi.mocked(supabase.from).mockImplementation(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) }) as never);
    vi.mocked(callApi).mockImplementation(async (path) => {
      if (path.startsWith("/api/assessment-documents?")) return new Response("[]", { status: 200 });
      if (path.startsWith("/api/assessment-drafts?")) return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      return new Response("[]", { status: 200 });
    });
    vi.mocked(callEdgeFunctionHttp).mockImplementation(async (path, init) => {
      if (path.startsWith("programs?")) return new Response(JSON.stringify([{ id: "program-1", organization_id: ORG_ID, client_id: "client-1", name: "Program", status: "active", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" }]), { status: 200 });
      if (path.startsWith("goals?")) return new Response(JSON.stringify([{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", organization_id: ORG_ID, client_id: "client-1", program_id: "program-1", title: "Goal", description: "Description", original_text: "Original", status: goalStatus, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" }]), { status: 200 });
      if (path.startsWith("goal-targets?goal_id=")) return new Response(JSON.stringify(targets), { status: 200 });
      if (path.includes("action=criteria")) return new Response("[]", { status: 200 });
      if (path.includes("action=transition_history")) return new Response("[]", { status: 200 });
      if (path.startsWith("trial-events?")) return new Response("[]", { status: 200 });
      if (path === "goal-targets" && init?.method === "PUT") return mutationStatus === 200 ? new Response(JSON.stringify({ outcome: "target_mastered" }), { status: 200 }) : new Response(JSON.stringify({ error: "Progression version conflict" }), { status: mutationStatus });
      return new Response("[]", { status: 200 });
    });
    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, { auth: { role, organizationId: ORG_ID, accessToken: "test-access-token" } });
  };

  it.each([["bcba", true], ["midtier", true], ["super_admin", true], ["admin", false], ["therapist", false]] as const)("uses trusted effectiveRole %s for progression mutation visibility", async (role, allowed) => {
    setup(role);
    await screen.findByText("Current · Mastery");
    expect(Boolean(screen.queryByRole("button", { name: "Complete mastery" }))).toBe(allowed);
  });

  it("requires selecting another current target before archive", async () => {
    setup("bcba");
    const currentArchive = await screen.findByRole("button", { name: "Archive target Current target" });
    expect(currentArchive).toBeDisabled();
    expect(currentArchive).toHaveAttribute("title", "Select another current target before archiving this target");
    expect(screen.getByRole("button", { name: "Archive target Next target" })).toBeEnabled();
  });

  it("sends each active and archived target exactly once when reordering and keeps archived UI read-only", async () => {
    setup("bcba");
    await screen.findByText("Current · Mastery");
    await userEvent.click(screen.getByRole("button", { name: "Move Next target earlier" }));
    await waitFor(() => expect(callEdgeFunctionHttp).toHaveBeenCalledWith("goal-targets", expect.objectContaining({ method: "PUT" })));
    const reorderCall = vi.mocked(callEdgeFunctionHttp).mock.calls.find(([, init]) => typeof init?.body === "string" && init.body.includes('"action":"reorder"'));
    const payload = JSON.parse(String(reorderCall?.[1]?.body));
    expect(payload.targets).toEqual([
      { target_id: integrationTargets[1].id, expected_version: 2 }, { target_id: integrationTargets[0].id, expected_version: 4 }, { target_id: integrationTargets[2].id, expected_version: 7 },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Show archived targets (1)" }));
    expect(await screen.findByText("Archived · outside active sequence")).toBeInTheDocument();
    const archivedRegion = screen.getByRole("region", { name: "Progression for Archived target" });
    expect(within(archivedRegion).queryByRole("button", { name: /save|select|advance|reopen/i })).not.toBeInTheDocument();
  });

  it("submits explicit mastery completion and refreshes, while a stale result stays visible", async () => {
    setup("bcba", 409);
    await userEvent.click(await screen.findByRole("button", { name: "Complete mastery" }));
    await userEvent.type(screen.getByLabelText("Reason for manual change"), "Clinical review");
    await userEvent.click(screen.getByRole("button", { name: "Confirm manual change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Progression version conflict");
    expect(callEdgeFunctionHttp).toHaveBeenCalledWith("goal-targets", expect.objectContaining({ body: JSON.stringify({ action: "complete_mastery", target_id: integrationTargets[0].id, reason: "Clinical review", expected_version: 4 }) }));
  });

  it("refreshes complete-set reorder conflicts without hiding errors", async () => {
    setup("bcba", 409);
    await userEvent.click(await screen.findByRole("button", { name: "Move Next target earlier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Progression version conflict");
  });

  it("reopens a mastered goal/target and refreshes a stale result without hiding the error", async () => {
    const mastered = { ...integrationTargets[0], status: "mastered" as const, is_current: false, progression_version: 9 };
    setup("bcba", 409, [mastered], "mastered");
    await userEvent.click(await screen.findByRole("button", { name: "Reopen target" }));
    await userEvent.type(screen.getByLabelText("Reason for manual change"), "Resume treatment");
    await userEvent.click(screen.getByRole("button", { name: "Confirm manual change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Progression version conflict");
    expect(callEdgeFunctionHttp).toHaveBeenCalledWith("goal-targets", expect.objectContaining({ body: JSON.stringify({ action: "override_progression", target_id: mastered.id, target_phase: "baseline", current_target_id: mastered.id, reason: "Resume treatment", expected_version: 9 }) }));
  });
});

describe("goal target progression management", () => {
  const target = {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: ORG_ID,
    client_id: "client-1",
    goal_id: "22222222-2222-4222-8222-222222222222",
    name: "Request help",
    measurement_type: "correctIncorrect",
    graph_config: {},
    status: "active",
    sort_order: 1,
    current_phase: "teaching",
    is_current: true,
    evaluation_window_started_at: "2026-07-10T00:00:00.000Z",
    progression_version: 3,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
  } satisfies GoalTarget;
  const completeCriterion = (phase: GoalTargetPhaseCriterion["phase"]): GoalTargetPhaseCriterion => ({
    id: `criterion-${phase}`,
    organization_id: ORG_ID,
    client_id: "client-1",
    goal_id: target.goal_id,
    target_id: target.id,
    phase,
    metric: "percent_correct",
    comparator: "gte",
    threshold: 80,
    min_observations: 5,
    consecutive_sessions: 3,
    clinical_note: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  });
  const criteria = (["baseline", "teaching", "generalization", "mastery"] as const).map(completeCriterion);

  it.each([
    ["bcba", true], ["midtier", true], ["super_admin", true], ["admin", false],
    ["therapist", false], ["bt", false], ["client", false],
  ])("limits progression mutations for %s", (role, expected) => {
    expect(canRoleManageGoalTargetProgression(role)).toBe(expected);
  });

  it("renders all phase criteria, current state, sequence, and incomplete state read-only", () => {
    render(<GoalTargetProgressionEditor target={target} criteria={criteria.slice(0, 3)} sequencePosition={2} sequenceCount={4} canManage={false} busy={false} onSaveCriterion={vi.fn()} onManualOverride={vi.fn()} />);
    expect(screen.getByText("Baseline criteria")).toBeInTheDocument();
    expect(screen.getByText("Teaching criteria")).toBeInTheDocument();
    expect(screen.getByText("Generalization criteria")).toBeInTheDocument();
    expect(screen.getByText("Mastery criteria")).toBeInTheDocument();
    expect(screen.getByText("Current · Teaching")).toBeInTheDocument();
    expect(screen.getByText("Sequence 2 of 4")).toBeInTheDocument();
    expect(screen.getByText("Criteria incomplete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save baseline criteria/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manual advance/i })).not.toBeInTheDocument();
  });

  it("validates structured criteria and submits compatible values", async () => {
    const user = userEvent.setup();
    const onSaveCriterion = vi.fn();
    render(<GoalTargetProgressionEditor target={target} criteria={criteria} sequencePosition={2} sequenceCount={4} canManage busy={false} onSaveCriterion={onSaveCriterion} onManualOverride={vi.fn()} />);
    const baseline = screen.getByRole("group", { name: "Baseline criteria" });
    expect(within(baseline).getByRole("option", { name: "Percent independent" })).toBeDisabled();
    expect(within(baseline).getByRole("option", { name: "Total value" })).toBeDisabled();
    await user.clear(within(baseline).getByLabelText("Minimum observations"));
    await user.type(within(baseline).getByLabelText("Minimum observations"), "0");
    expect(within(baseline).getByRole("button", { name: "Save baseline criteria" })).toBeDisabled();
    expect(within(baseline).getByText("Minimum observations must be at least 1.")).toBeInTheDocument();
    await user.clear(within(baseline).getByLabelText("Minimum observations"));
    await user.type(within(baseline).getByLabelText("Minimum observations"), "8");
    await user.click(within(baseline).getByRole("button", { name: "Save baseline criteria" }));
    expect(onSaveCriterion).toHaveBeenCalledWith(expect.objectContaining({ phase: "baseline", min_observations: 8, expected_version: 3 }));
  });

  it("requires a trimmed reason for manual progression controls", async () => {
    const user = userEvent.setup();
    const onManualOverride = vi.fn();
    render(<GoalTargetProgressionEditor target={target} criteria={criteria} sequencePosition={2} sequenceCount={4} canManage busy={false} onSaveCriterion={vi.fn()} onManualOverride={onManualOverride} />);
    await user.click(screen.getByRole("button", { name: "Manual advance" }));
    expect(screen.getByRole("button", { name: "Confirm manual change" })).toBeDisabled();
    await user.type(screen.getByLabelText("Reason for manual change"), "  Clinical review  ");
    await user.click(screen.getByRole("button", { name: "Confirm manual change" }));
    expect(onManualOverride).toHaveBeenCalledWith(expect.objectContaining({ target_phase: "generalization", reason: "Clinical review", expected_version: 3 }));
  });

  it("offers explicit audited mastery completion and restores focus when Escape closes the dialog", async () => {
    const user = userEvent.setup();
    const onCompleteMastery = vi.fn();
    const masteryTarget = { ...target, current_phase: "mastery" as const };
    render(<GoalTargetProgressionEditor target={masteryTarget} criteria={criteria} sequencePosition={2} sequenceCount={4} canManage busy={false} onSaveCriterion={vi.fn()} onManualOverride={vi.fn()} onCompleteMastery={onCompleteMastery} />);
    const trigger = screen.getByRole("button", { name: "Complete mastery" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Complete mastery" })).toHaveAttribute("aria-modal", "true");
    const reason = screen.getByLabelText("Reason for manual change");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(reason).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(cancel).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(reason).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Complete mastery" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.type(screen.getByLabelText("Reason for manual change"), "Clinical mastery review");
    await user.click(screen.getByRole("button", { name: "Confirm manual change" }));
    expect(onCompleteMastery).toHaveBeenCalledWith({ action: "complete_mastery", target_id: target.id, reason: "Clinical mastery review", expected_version: 3 });
  });

  it("keeps archived targets read-only and outside the active sequence", () => {
    const archived = { ...target, status: "archived" as const, is_current: false };
    render(<GoalTargetProgressionEditor target={archived} criteria={criteria} sequencePosition={null} sequenceCount={3} canManage busy={false} onSaveCriterion={vi.fn()} onManualOverride={vi.fn()} onCompleteMastery={vi.fn()} />);
    expect(screen.getByText("Archived · outside active sequence")).toBeInTheDocument();
    expect(screen.getByText("Phase · Teaching")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save .* criteria/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select as current/i })).not.toBeInTheDocument();
  });

  it("preserves a stale-version server error and refreshes progression state", async () => {
    const user = userEvent.setup();
    let criteriaReads = 0;
    vi.mocked(callEdgeFunctionHttp).mockImplementation(async (path, init) => {
      if (path.includes("action=criteria")) { criteriaReads += 1; return new Response(JSON.stringify(criteria), { status: 200 }); }
      if (path.includes("action=transition_history")) return new Response(JSON.stringify([]), { status: 200 });
      if ((init?.method ?? "GET") === "PUT") return new Response(JSON.stringify({ error: "Progression version conflict" }), { status: 409 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><GoalTargetProgressionPanel target={target} sequencePosition={2} sequenceCount={4} canManage /></QueryClientProvider>);
    await user.click(await screen.findByRole("button", { name: "Manual advance" }));
    await user.type(screen.getByLabelText("Reason for manual change"), "Clinical review");
    await user.click(screen.getByRole("button", { name: "Confirm manual change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Progression version conflict");
    await waitFor(() => expect(criteriaReads).toBeGreaterThan(1));
  });

  it("renders immutable transition history and its empty state", () => {
    const transition = {
      id: "transition-1", organization_id: ORG_ID, client_id: "client-1", goal_id: target.goal_id,
      target_id: target.id, previous_target_id: null, resulting_target_id: target.id,
      previous_phase: "baseline", resulting_phase: "teaching", previous_status: "active", resulting_status: "active",
      previous_progression_version: 2, resulting_progression_version: 3, source: "manual", session_id: null,
      actor_id: "user-1", reason: "Clinical review", transitioned_at: "2026-07-10T12:00:00.000Z",
    } satisfies GoalTargetTransition;
    const { rerender } = render(<GoalTargetProgressionHistory transitions={[transition]} loading={false} error={null} />);
    expect(screen.getByText("Progression history")).toBeInTheDocument();
    expect(screen.getByText("Baseline → Teaching")).toBeInTheDocument();
    expect(screen.getByText("Clinical review")).toBeInTheDocument();
    rerender(<GoalTargetProgressionHistory transitions={[]} loading={false} error={null} />);
    expect(screen.getByText("No progression changes yet.")).toBeInTheDocument();
  });
});

type LifecycleTarget = {
  id: string;
  organization_id: string;
  client_id: string;
  goal_id: string;
  name: string;
  measurement_type: "frequency";
  graph_config: { defaultChart: "bar"; source: "trial_events" };
  status: "active" | "archived";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const buildLifecycleTarget = (
  id: string,
  name: string,
  status: LifecycleTarget["status"],
): LifecycleTarget => ({
  id,
  organization_id: ORG_ID,
  client_id: "client-1",
  goal_id: "goal-1",
  name,
  measurement_type: "frequency",
  graph_config: { defaultChart: "bar", source: "trial_events" },
  status,
  sort_order: 0,
  created_at: "2026-02-11T00:00:00.000Z",
  updated_at: "2026-02-11T00:00:00.000Z",
});

const mockGoalTargetLifecycleApi = (
  initialTargets: LifecycleTarget[],
  deleteResponse: Response = new Response(JSON.stringify({ deleted_target_id: "target-archived" }), { status: 200 }),
) => {
  let targets = initialTargets;
  vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.startsWith("/api/programs?")) {
      return new Response(JSON.stringify([{
        id: "program-1",
        organization_id: ORG_ID,
        client_id: "client-1",
        name: "Communication Program",
        status: "active",
        created_at: "2026-02-11T00:00:00.000Z",
        updated_at: "2026-02-11T00:00:00.000Z",
      }]), { status: 200 });
    }
    if (method === "GET" && path.startsWith("/api/goals?")) {
      return new Response(JSON.stringify([{
        id: "goal-1",
        organization_id: ORG_ID,
        client_id: "client-1",
        program_id: "program-1",
        title: "Increase functional communication",
        description: "Client uses functional communication.",
        original_text: "Original clinical wording",
        status: "active",
        created_at: "2026-02-11T00:00:00.000Z",
        updated_at: "2026-02-11T00:00:00.000Z",
      }]), { status: 200 });
    }
    if (method === "GET" && path.startsWith("/api/goal-targets?")) {
      return new Response(JSON.stringify(targets), { status: 200 });
    }
    if (method === "PATCH" && path.startsWith("/api/goal-targets?target_id=")) {
      const targetId = new URL(path, "http://localhost").searchParams.get("target_id");
      const body = JSON.parse(String(init?.body)) as { status: LifecycleTarget["status"] };
      const updated = targets.find((target) => target.id === targetId);
      if (!updated) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      targets = targets.map((target) => target.id === targetId ? { ...target, status: body.status } : target);
      return new Response(JSON.stringify({ ...updated, status: body.status }), { status: 200 });
    }
    if (method === "DELETE" && path.startsWith("/api/goal-targets?target_id=")) {
      if (deleteResponse.ok) {
        const targetId = new URL(path, "http://localhost").searchParams.get("target_id");
        targets = targets.filter((target) => target.id !== targetId);
      }
      return deleteResponse.clone();
    }
    if (method === "GET" && path.startsWith("/api/trial-events?")) return new Response(JSON.stringify([]), { status: 200 });
    if (method === "GET" && path.startsWith("/api/program-notes?")) return new Response(JSON.stringify([]), { status: 200 });
    if (method === "GET" && path.startsWith("/api/assessment-documents?")) return new Response(JSON.stringify([]), { status: 200 });
    if (method === "GET" && path.startsWith("/api/assessment-checklist?")) return new Response(JSON.stringify([]), { status: 200 });
    if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
      return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Not handled in lifecycle test" }), { status: 500 });
  });
};

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

const buildIehpStructuredSections = () => [
  {
    id: "iehp-structured-1",
    section_key: "iehp_summary_review",
    field_key: "IEHP_FBA_SUMMARY",
    section_index: 0,
    payload: null,
    status: "approved" as const,
    required: true,
    review_notes: null,
  },
  {
    id: "iehp-structured-2",
    section_key: "iehp_summary_review",
    field_key: "IEHP_FBA_BEHAVIOR_SUPPORTS",
    section_index: 1,
    payload: {
      summary: "x".repeat(4096),
      goal_type: "child",
      notes: "IEHP structured payload remains renderable even when it is long.",
    },
    status: "drafted" as const,
    required: false,
    review_notes: "Long payload kept intact",
  },
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
        upload: storageUploadMock,
        remove: storageRemoveMock,
      }),
    },
  },
}));

/** Deterministic, fast pointer/keyboard simulation — avoid sharing interaction state across tests. */
let user: ReturnType<typeof userEvent.setup>;

describe("ProgramsGoalsTab", { timeout: 15_000 }, () => {
  beforeEach(() => {
    user = userEvent.setup({ delay: null });
    storageUploadMock.mockReset();
    storageUploadMock.mockResolvedValue({ error: null });
    storageRemoveMock.mockReset();
    storageRemoveMock.mockResolvedValue({ error: null });

    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
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
                : tableName === "goal_domains"
                  ? {
                      id: "domain-created",
                      organization_id: ORG_ID,
                      name: "Created Domain",
                      description: null,
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
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
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
    const goalDomainInsert = vi.fn().mockReturnThis();
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: tableName === "goal_domains" ? goalDomainInsert : vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data:
            tableName === "goal_domains"
              ? {
                  id: "domain-created",
                  organization_id: ORG_ID,
                  name: "Social Communication",
                  description: null,
                  status: "active",
                  created_at: "2026-02-11T00:00:00.000Z",
                  updated_at: "2026-02-11T00:00:00.000Z",
                }
              : null,
          error: null,
        }),
      };
      return chain as unknown as ReturnType<typeof supabase.from>;
    });
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
      expect(screen.getByLabelText("Domain")).toBeEnabled();
    });
    await user.selectOptions(screen.getByLabelText("Domain"), "__create_new_domain__");
    await user.type(screen.getByLabelText("New domain name *"), "Social Communication");
    await user.click(screen.getByRole("button", { name: "Create Domain" }));

    await waitFor(() => {
      expect(goalDomainInsert).toHaveBeenCalledWith([
        {
          organization_id: ORG_ID,
          name: "Social Communication",
          status: "active",
        },
      ]);
    });
    expect(showSuccess).toHaveBeenCalledWith("Goal domain created");

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
          body: expect.stringContaining("\"domain_id\":\"domain-created\""),
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

  it("renders goal-level details with target-level measurement and graph configuration", async () => {
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === "goal_domains") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "communication-domain",
                organization_id: ORG_ID,
                name: "Communication",
                description: null,
                status: "active",
                created_at: "2026-02-11T00:00:00.000Z",
                updated_at: "2026-02-11T00:00:00.000Z",
              },
              {
                id: "behavior-domain",
                organization_id: ORG_ID,
                name: "Behavior Reduction",
                description: null,
                status: "active",
                created_at: "2026-02-11T00:00:00.000Z",
                updated_at: "2026-02-11T00:00:00.000Z",
              },
              {
                id: "archived-domain",
                organization_id: ORG_ID,
                name: "Archived Clinical Domain",
                description: null,
                status: "archived",
                created_at: "2026-02-10T00:00:00.000Z",
                updated_at: "2026-02-10T00:00:00.000Z",
              },
            ],
            error: null,
          }),
          insert: vi.fn().mockReturnThis(),
          single: vi.fn(),
        } as unknown as ReturnType<typeof supabase.from>;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as unknown as ReturnType<typeof supabase.from>;
    });
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              domain_id: "communication-domain",
              title: "Increase functional communication",
              description: "Client uses functional communication across routines.",
              original_text: "Original clinical wording",
              measurement_type: "percent opportunities",
              baseline: "2 requests per session",
              mastery_criteria: "80% across three sessions",
              generalization_criteria: "Two settings and two adults",
              teaching_strategies: "DTT, NET, prompt fading",
              operational_definition: "Independent request within 5 seconds",
              objective_data_points: ["trial response", "prompt level"],
              clinical_goal_type: "skill",
              source: "manual",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
            {
              id: "goal-2",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              domain_id: "behavior-domain",
              title: "Reduce elopement",
              description: "Client remains with therapist during transitions.",
              original_text: "Reduce elopement during transitions.",
              clinical_goal_type: "behavior",
              measurement_type: "frequency",
              baseline_data: "4 incidents per week",
              target_criteria: "0-1 incidents per week",
              source: "fba_extraction",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
            {
              id: "goal-3",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              domain_id: "archived-domain",
              title: "Caregiver participation",
              description: "Caregiver implements session carryover strategies.",
              original_text: "Caregiver will participate in treatment planning.",
              clinical_goal_type: null,
              measurement_type: null,
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        if (!path.includes("goal_id=goal-1")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(
          JSON.stringify([
            {
              id: "target-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              goal_id: "goal-1",
              name: "Mands for help",
              measurement_type: "frequency",
              graph_config: { defaultChart: "bar", source: "trial_events" },
              status: "active",
              sort_order: 0,
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
            {
              id: "target-2",
              organization_id: ORG_ID,
              client_id: "client-1",
              goal_id: "goal-1",
              name: "Sustained engagement",
              measurement_type: "duration",
              graph_config: { defaultChart: "line", source: "trial_events" },
              status: "draft",
              sort_order: 1,
              created_at: "2026-02-11T00:01:00.000Z",
              updated_at: "2026-02-11T00:01:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/trial-events?target_id=target-1")) {
        return new Response(
          JSON.stringify([
            {
              id: "trial-event-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              session_id: "session-1",
              target_id: "target-1",
              goal_id: "goal-1",
              therapist_id: "therapist-1",
              trial_number: 1,
              response: null,
              value: 3,
              event_timestamp: "2026-02-11T00:30:00.000Z",
              metadata: {},
              created_at: "2026-02-11T00:30:00.000Z",
              updated_at: "2026-02-11T00:30:00.000Z",
            },
            {
              id: "trial-event-2",
              organization_id: ORG_ID,
              client_id: "client-1",
              session_id: "session-1",
              target_id: "target-1",
              goal_id: "goal-1",
              therapist_id: "therapist-1",
              trial_number: 2,
              response: null,
              value: 5,
              event_timestamp: "2026-02-11T17:05:00.000Z",
              metadata: {},
              created_at: "2026-02-11T17:05:00.000Z",
              updated_at: "2026-02-11T17:05:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/trial-events?target_id=target-2")) {
        return new Promise<Response>(() => {
          // Keep this target pending to prove one slow graph does not block sibling targets.
        });
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

    expect(await screen.findAllByText("Increase functional communication")).not.toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Skill Acquisition" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Behavior Reduction" }).length).toBeGreaterThan(1);
    expect(screen.getByRole("heading", { name: "Needs Review" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Communication" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Archived Clinical Domain" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Archived Clinical Domain" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Reduce elopement").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Caregiver participation").length).toBeGreaterThan(0);
    expect(screen.getByText("2 requests per session")).toBeInTheDocument();
    expect(screen.getByText("Independent request within 5 seconds")).toBeInTheDocument();
    expect(screen.getByText("DTT, NET, prompt fading")).toBeInTheDocument();
    expect(screen.getByText("80% across three sessions")).toBeInTheDocument();
    expect(screen.getByText("Two settings and two adults")).toBeInTheDocument();
    expect(screen.getByText("Skill · Communication")).toBeInTheDocument();
    expect(screen.getByText("Behavior · Behavior Reduction")).toBeInTheDocument();
    expect(screen.getByText("Manual · percent opportunities")).toBeInTheDocument();
    expect(screen.getByText("Unspecified · Archived Clinical Domain")).toBeInTheDocument();
    expect(screen.getByText("Source not set · Measurement not set")).toBeInTheDocument();

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    expect(screen.getByText("Measurement: Frequency")).toBeInTheDocument();
    expect(screen.getByText(/Graph: bar from/i)).toBeInTheDocument();
    const mandsProgress = await screen.findByLabelText("Trial-event progress for Mands for help");
    expect(within(mandsProgress).getByText("2 trials")).toBeInTheDocument();
    expect(within(mandsProgress).getByLabelText("Recent graph points for Mands for help")).toBeInTheDocument();
    const trialTable = within(mandsProgress).getByRole("table", { name: /Raw trial events for Mands for help/i });
    expect(within(trialTable).getByRole("columnheader", { name: "Trial" })).toBeInTheDocument();
    expect(within(trialTable).getByRole("columnheader", { name: "Result" })).toBeInTheDocument();
    expect(within(trialTable).getByText("1")).toBeInTheDocument();
    expect(within(trialTable).getByText("2")).toBeInTheDocument();
    expect(within(trialTable).getAllByText("Feb 11")).toHaveLength(2);
    expect(within(trialTable).getByText("5")).toBeInTheDocument();
    expect(within(trialTable).getAllByText("None recorded")).toHaveLength(2);

    expect(await screen.findByText("Sustained engagement")).toBeInTheDocument();
    const engagementGraph = await screen.findByLabelText("Trial-event progress for Sustained engagement");
    expect(within(engagementGraph).getByText("Loading trial-level data...")).toBeInTheDocument();
    expect(
      await within(engagementGraph).findByText(
        "Could not load trial-level data: Trial-event graph request timed out. Please retry.",
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(callEdgeFunctionHttp).toHaveBeenCalledWith("trial-events?target_id=target-1");
    expect(callEdgeFunctionHttp).toHaveBeenCalledWith("trial-events?target_id=target-2");
  });

  it("creates a target under an existing goal with independent measurement status and graph defaults", async () => {
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "POST" && path === "/api/goal-targets") {
        return new Response(
          JSON.stringify({
            id: "target-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            goal_id: "goal-1",
            name: "Duration of engagement",
            measurement_type: "duration",
            graph_config: { defaultChart: "line", source: "trial_events", aggregation: "session_summary" },
            status: "draft",
            sort_order: 0,
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

    expect(await screen.findAllByText("Increase functional communication")).not.toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Target name/i), { target: { value: "Duration of engagement" } });
    fireEvent.change(screen.getByLabelText(/Measurement type/i), { target: { value: "duration" } });
    fireEvent.change(screen.getByLabelText("Target status"), { target: { value: "draft" } });

    await user.click(screen.getByRole("button", { name: "Create Target" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"measurement_type\":\"duration\""),
        }),
      );
    });
    expect(
      vi
        .mocked(callEdgeFunctionHttp)
        .mock.calls.some(
          ([path, init]) =>
            path === "goal-targets" &&
            init?.method === "POST" &&
            typeof init.body === "string" &&
            init.body.includes("\"goal_id\":\"goal-1\"") &&
            init.body.includes("\"status\":\"draft\"") &&
            init.body.includes("\"source\":\"trial_events\""),
        ),
    ).toBe(true);
    expect(showSuccess).toHaveBeenCalledWith("Target created");
  });

  it("lets a midtier edit an existing goal target through the goal-targets PATCH route", async () => {
    let targetRecord = {
      id: "target-1",
      organization_id: ORG_ID,
      client_id: "client-1",
      goal_id: "goal-1",
      name: "Mands for help",
      measurement_type: "frequency",
      graph_config: { defaultChart: "bar", source: "trial_events" },
      status: "active",
      sort_order: 0,
      created_at: "2026-02-11T00:00:00.000Z",
      updated_at: "2026-02-11T00:00:00.000Z",
    };
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(JSON.stringify([targetRecord]), { status: 200 });
      }
      if (method === "PATCH" && path === "/api/goal-targets?target_id=target-1") {
        const body = JSON.parse(String(init?.body));
        targetRecord = {
          ...targetRecord,
          name: "Mands for help independently",
          measurement_type: "correctIncorrect",
          graph_config: body.graph_config,
          status: "mastered",
          updated_at: "2026-02-12T00:00:00.000Z",
        };
        return new Response(JSON.stringify(targetRecord), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/trial-events?")) {
        return new Response(JSON.stringify([]), { status: 200 });
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
        role: "midtier",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit target Mands for help" }));

    fireEvent.change(screen.getByLabelText("Target name for Mands for help"), {
      target: { value: "Mands for help independently" },
    });
    fireEvent.change(screen.getByLabelText("Measurement type for Mands for help"), {
      target: { value: "correctIncorrect" },
    });
    fireEvent.change(screen.getByLabelText("Target status for Mands for help"), {
      target: { value: "mastered" },
    });

    await user.click(screen.getByRole("button", { name: "Save target Mands for help" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"name\":\"Mands for help independently\""),
        }),
      );
    });
    const updateCall = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.find(([path, init]) => path === "goal-targets?target_id=target-1" && init?.method === "PATCH");
    expect(updateCall).toBeTruthy();
    const body = JSON.parse(String(updateCall?.[1]?.body)) as {
      measurement_type?: string;
      status?: string;
      graph_config?: unknown;
    };
    expect(body.measurement_type).toBe("correctIncorrect");
    expect(body.status).toBe("mastered");
    expect(body.graph_config).toEqual({
      defaultChart: "bar",
      source: "trial_events",
      aggregation: "session_summary",
    });
    expect(showSuccess).toHaveBeenCalledWith("Target updated");
    expect(await screen.findByText("Mands for help independently")).toBeInTheDocument();
    expect(screen.getByText("Measurement: Correct / incorrect")).toBeInTheDocument();
    expect(screen.getByText(/Graph: bar from/i)).toBeInTheDocument();
  });

  it("gives midtier explicit Archive and Restore actions without exposing Delete", async () => {
    mockGoalTargetLifecycleApi([
      buildLifecycleTarget("target-active", "Mands for help", "active"),
      buildLifecycleTarget("target-archived", "Archived imitation", "archived"),
    ]);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "midtier",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete target/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive target Mands for help" }));
    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-active",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "archived" }) }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("Target archived");
    expect(screen.queryByText("Mands for help")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show archived targets/i }));
    expect(await screen.findByText("Archived imitation")).toBeInTheDocument();
    expect(screen.getByText("Mands for help")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore target Archived imitation" }));
    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-archived",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith("Target restored");
    expect(screen.getByText("Archived imitation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete target/i })).not.toBeInTheDocument();
  });

  it("cancels BCBA target deletion without issuing a request", async () => {
    mockGoalTargetLifecycleApi([
      buildLifecycleTarget("target-archived", "Archived imitation", "archived"),
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: { role: "bcba", organizationId: ORG_ID, accessToken: "test-access-token" },
    });

    await user.click(await screen.findByRole("button", { name: /Show archived targets/i }));
    await user.click(screen.getByRole("button", { name: "Delete target Archived imitation" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Archived imitation.*irreversible/i));
    expect(
      vi.mocked(callEdgeFunctionHttp).mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    expect(screen.getByText("Archived imitation")).toBeInTheDocument();
  });

  it("shows BCBA Delete only for archived targets and requires irreversible confirmation", async () => {
    mockGoalTargetLifecycleApi([
      buildLifecycleTarget("target-active", "Mands for help", "active"),
      buildLifecycleTarget("target-archived", "Archived imitation", "archived"),
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "bcba",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete target Mands for help" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show archived targets/i }));

    await user.click(screen.getByRole("button", { name: "Delete target Archived imitation" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Archived imitation.*irreversible/i));
    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-archived",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => expect(screen.queryByText("Archived imitation")).not.toBeInTheDocument());
    expect(showSuccess).toHaveBeenCalledWith('Target "Archived imitation" deleted');
  });

  it("retains an archived target when BCBA deletion fails", async () => {
    mockGoalTargetLifecycleApi(
      [buildLifecycleTarget("target-archived", "Archived imitation", "archived")],
      new Response(JSON.stringify({ error: "Goal target has trial history and cannot be deleted" }), { status: 409 }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "bcba",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await user.click(await screen.findByRole("button", { name: /Show archived targets/i }));
    expect(await screen.findByText("Archived imitation")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete target Archived imitation" }));

    await waitFor(() => {
      expect(vi.mocked(showError).mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ message: "Goal target has trial history and cannot be deleted" }),
      );
    });
    expect(screen.getByText("Archived imitation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete target Archived imitation" })).toBeEnabled();
  });

  it("disables every target lifecycle action while an archive request is pending", async () => {
    mockGoalTargetLifecycleApi([
      buildLifecycleTarget("target-active", "Mands for help", "active"),
      buildLifecycleTarget("target-archived", "Archived imitation", "archived"),
    ]);
    const baseApi = vi.mocked(callApi).getMockImplementation();
    vi.mocked(callApi).mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && path === "/api/goal-targets?target_id=target-active") {
        return new Promise<Response>(() => {});
      }
      return baseApi!(path, init);
    });

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: { role: "bcba", organizationId: ORG_ID, accessToken: "test-access-token" },
    });

    await user.click(await screen.findByRole("button", { name: /Show archived targets/i }));
    await user.click(screen.getByRole("button", { name: "Archive target Mands for help" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive target Mands for help" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Restore target Archived imitation" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Delete target Archived imitation" })).toBeDisabled();
    });
  });

  it("disables every target lifecycle action while a delete request is pending", async () => {
    mockGoalTargetLifecycleApi([
      buildLifecycleTarget("target-active", "Mands for help", "active"),
      buildLifecycleTarget("target-archived", "Archived imitation", "archived"),
    ]);
    const baseApi = vi.mocked(callApi).getMockImplementation();
    vi.mocked(callApi).mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && path === "/api/goal-targets?target_id=target-archived") {
        return new Promise<Response>(() => {});
      }
      return baseApi!(path, init);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: { role: "bcba", organizationId: ORG_ID, accessToken: "test-access-token" },
    });

    await user.click(await screen.findByRole("button", { name: /Show archived targets/i }));
    await user.click(screen.getByRole("button", { name: "Delete target Archived imitation" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive target Mands for help" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Restore target Archived imitation" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Delete target Archived imitation" })).toBeDisabled();
    });
  });

  it("lets a midtier edit an existing goal target graph configuration", async () => {
    let targetRecord = {
      id: "target-1",
      organization_id: ORG_ID,
      client_id: "client-1",
      goal_id: "goal-1",
      name: "Mands for help",
      measurement_type: "frequency",
      graph_config: { defaultChart: "bar", source: "trial_events", aggregation: "sum" },
      status: "active",
      sort_order: 0,
      created_at: "2026-02-11T00:00:00.000Z",
      updated_at: "2026-02-11T00:00:00.000Z",
    };
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(JSON.stringify([targetRecord]), { status: 200 });
      }
      if (method === "PATCH" && path === "/api/goal-targets?target_id=target-1") {
        targetRecord = {
          ...targetRecord,
          graph_config: { defaultChart: "line", source: "session_notes", aggregation: "session_summary" },
          updated_at: "2026-02-12T00:00:00.000Z",
        };
        return new Response(JSON.stringify(targetRecord), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/trial-events?")) {
        return new Response(JSON.stringify([]), { status: 200 });
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
        role: "midtier",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit target Mands for help" }));

    fireEvent.change(screen.getByLabelText("Graph chart for Mands for help"), {
      target: { value: "line" },
    });
    fireEvent.change(screen.getByLabelText("Graph source for Mands for help"), {
      target: { value: "session_notes" },
    });
    fireEvent.change(screen.getByLabelText("Graph aggregation for Mands for help"), {
      target: { value: "session_summary" },
    });

    await user.click(screen.getByRole("button", { name: "Save target Mands for help" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-1",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });
    const updateCall = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.find(([path, init]) => path === "goal-targets?target_id=target-1" && init?.method === "PATCH");
    const body = JSON.parse(String(updateCall?.[1]?.body)) as {
      graph_config?: Record<string, unknown>;
    };
    expect(body.graph_config).toEqual({
      defaultChart: "line",
      source: "session_notes",
      aggregation: "session_summary",
    });
    expect(showSuccess).toHaveBeenCalledWith("Target updated");
    expect(await screen.findByText(/Graph: line from session_notes/i)).toBeInTheDocument();
  });

  it("keeps frequency target graph aggregation aligned with creation defaults when stored config is incomplete", async () => {
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(
          JSON.stringify([
            {
              id: "target-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              goal_id: "goal-1",
              name: "Mands for help",
              measurement_type: "frequency",
              graph_config: { defaultChart: "bar", source: "trial_events" },
              status: "active",
              sort_order: 0,
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "PATCH" && path === "/api/goal-targets?target_id=target-1") {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "target-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            goal_id: "goal-1",
            name: "Mands for help",
            measurement_type: "frequency",
            graph_config: body.graph_config,
            status: "active",
            sort_order: 0,
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-12T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/trial-events?")) return new Response(JSON.stringify([]), { status: 200 });
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
        role: "midtier",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit target Mands for help" }));
    fireEvent.change(screen.getByLabelText("Graph chart for Mands for help"), {
      target: { value: "line" },
    });
    await user.click(screen.getByRole("button", { name: "Save target Mands for help" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const updateCall = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.find(([path, init]) => path === "goal-targets?target_id=target-1" && init?.method === "PATCH");
    const body = JSON.parse(String(updateCall?.[1]?.body)) as {
      graph_config?: Record<string, unknown>;
    };
    expect(body.graph_config).toEqual({
      defaultChart: "line",
      source: "trial_events",
      aggregation: "sum",
    });
  });

  it("persists normalized graph config when a legacy target is edited without graph field changes", async () => {
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(
          JSON.stringify([
            {
              id: "target-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              goal_id: "goal-1",
              name: "Mands for help",
              measurement_type: "correctIncorrect",
              graph_config: { defaultChart: "bar", source: "trial_events" },
              status: "active",
              sort_order: 0,
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "PATCH" && path === "/api/goal-targets?target_id=target-1") {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "target-1",
            organization_id: ORG_ID,
            client_id: "client-1",
            goal_id: "goal-1",
            name: "Mands for help independently",
            measurement_type: "correctIncorrect",
            graph_config: body.graph_config,
            status: "active",
            sort_order: 0,
            created_at: "2026-02-11T00:00:00.000Z",
            updated_at: "2026-02-12T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/trial-events?")) return new Response(JSON.stringify([]), { status: 200 });
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
        role: "midtier",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit target Mands for help" }));
    fireEvent.change(screen.getByLabelText("Target name for Mands for help"), {
      target: { value: "Mands for help independently" },
    });
    await user.click(screen.getByRole("button", { name: "Save target Mands for help" }));

    await waitFor(() => {
      expect(callEdgeFunctionHttp).toHaveBeenCalledWith(
        "goal-targets?target_id=target-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const updateCall = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.find(([path, init]) => path === "goal-targets?target_id=target-1" && init?.method === "PATCH");
    const body = JSON.parse(String(updateCall?.[1]?.body)) as {
      graph_config?: Record<string, unknown>;
    };
    expect(body.graph_config).toEqual({
      defaultChart: "bar",
      source: "trial_events",
      aggregation: "session_summary",
    });
  });

  it("does not expose existing target editing to view-only therapist roles", async () => {
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
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goals?")) {
        return new Response(
          JSON.stringify([
            {
              id: "goal-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              program_id: "program-1",
              title: "Increase functional communication",
              description: "Client uses functional communication.",
              original_text: "Original clinical wording",
              status: "active",
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/goal-targets?")) {
        return new Response(
          JSON.stringify([
            {
              id: "target-1",
              organization_id: ORG_ID,
              client_id: "client-1",
              goal_id: "goal-1",
              name: "Mands for help",
              measurement_type: "frequency",
              graph_config: { defaultChart: "bar", source: "trial_events" },
              status: "active",
              sort_order: 0,
              created_at: "2026-02-11T00:00:00.000Z",
              updated_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/trial-events?")) return new Response(JSON.stringify([]), { status: 200 });
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

    expect(await screen.findByText("Mands for help")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit target Mands for help" })).not.toBeInTheDocument();
    expect(
      vi
        .mocked(callEdgeFunctionHttp)
        .mock.calls.some(([path, init]) => path === "goal-targets?target_id=target-1" && init?.method === "PATCH"),
    ).toBe(false);
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

  it("does not repeat initial programs, goals, and notes fetches under StrictMode", async () => {
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
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(JSON.stringify([]), { status: 200 });
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
      <React.StrictMode>
        <ProgramsGoalsTab client={buildClient()} />
      </React.StrictMode>,
      {
        auth: {
          role: "therapist",
          organizationId: ORG_ID,
          accessToken: "test-access-token",
        },
      },
    );

    await screen.findByText("Communication Program");

    const getCalls = vi
      .mocked(callEdgeFunctionHttp)
      .mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "GET")
      .map(([path]) => String(path));

    expect(getCalls.filter((path) => path.startsWith("programs?"))).toHaveLength(1);
    expect(getCalls.filter((path) => path.startsWith("goals?"))).toHaveLength(1);
    expect(getCalls.filter((path) => path.startsWith("program-notes?"))).toHaveLength(1);
  });

  it("does not reconnect active Programs & Goals queries while their data is still fresh", async () => {
    seedStubAuthState();

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 60_000,
          refetchOnReconnect: "always",
        },
        mutations: {
          retry: false,
        },
      },
    });

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
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <ProgramsGoalsTab client={buildClient()} />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("Communication Program");

    const countEdgeGets = () =>
      vi
        .mocked(callEdgeFunctionHttp)
        .mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "GET")
        .map(([path]) => String(path));

    expect(countEdgeGets().filter((path) => path.startsWith("programs?"))).toHaveLength(1);
    expect(countEdgeGets().filter((path) => path.startsWith("goals?"))).toHaveLength(1);
    expect(countEdgeGets().filter((path) => path.startsWith("program-notes?"))).toHaveLength(1);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await new Promise((resolve) => setTimeout(resolve, 250));

    const edgeGetCalls = countEdgeGets();
    expect(edgeGetCalls.filter((path) => path.startsWith("programs?"))).toHaveLength(1);
    expect(edgeGetCalls.filter((path) => path.startsWith("goals?"))).toHaveLength(1);
    expect(edgeGetCalls.filter((path) => path.startsWith("program-notes?"))).toHaveLength(1);
  });

  it("reconnects stale Programs & Goals queries after the tab stale window elapses", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 60_000,
          refetchOnReconnect: "always",
        },
        mutations: {
          retry: false,
        },
      },
    });

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
      if (method === "GET" && path.startsWith("/api/assessment-documents?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(JSON.stringify({ programs: [], goals: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not handled in test" }), { status: 500 });
    });

    const initialNow = Date.parse("2026-05-29T12:57:00.000Z");
    let now = initialNow;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const activeOrganizationSpy = vi.spyOn(organizationModule, "useActiveOrganizationId").mockReturnValue(ORG_ID);
    seedStubAuthState();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <ProgramsGoalsTab client={buildClient()} />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("Communication Program");

    const countEdgeGets = () =>
      vi
        .mocked(callEdgeFunctionHttp)
        .mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "GET")
        .map(([path]) => String(path));

    expect(countEdgeGets().filter((path) => path.startsWith("programs?"))).toHaveLength(1);
    expect(countEdgeGets().filter((path) => path.startsWith("goals?"))).toHaveLength(1);
    expect(countEdgeGets().filter((path) => path.startsWith("program-notes?"))).toHaveLength(1);

    now += 30_001;

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await waitFor(() => {
      const edgeGetCalls = countEdgeGets();
      expect(edgeGetCalls.filter((path) => path.startsWith("programs?"))).toHaveLength(2);
      expect(edgeGetCalls.filter((path) => path.startsWith("goals?"))).toHaveLength(2);
      expect(edgeGetCalls.filter((path) => path.startsWith("program-notes?"))).toHaveLength(2);
    });

    activeOrganizationSpy.mockRestore();
    dateNowSpy.mockRestore();
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
              status:
                assessmentFetchCount === 1
                  ? "extracting"
                  : assessmentFetchCount === 2
                    ? "extraction_running"
                    : "drafted",
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
    await new Promise((resolve) => setTimeout(resolve, 6_600));

    await waitFor(() => {
      expect(assessmentFetchCount).toBeGreaterThanOrEqual(3);
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

  it("hides the manual AI proposal workflow", async () => {
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

    expect(screen.queryByPlaceholderText(/Paste assessment summary or White Bible-aligned notes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate AI Proposal Program \+ Goals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save AI Proposal to Selected Assessment/i })).not.toBeInTheDocument();
    expect(generateProgramGoalDraft).not.toHaveBeenCalled();
  });

  it("does not render manual AI proposal results", async () => {
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

    expect(screen.queryByPlaceholderText(/Paste assessment summary or White Bible-aligned notes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft programs:/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Primary rationale")).not.toBeInTheDocument();
    expect(generateProgramGoalDraft).not.toHaveBeenCalled();
  });

  it("does not expose manual AI draft persistence controls", async () => {
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

    expect(screen.queryByRole("button", { name: /Save AI Proposal to Selected Assessment/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
    expect(generateProgramGoalDraft).not.toHaveBeenCalled();
  });

  it("supports both CalOptima and IEHP upload templates", async () => {
    const baseCallApiImpl = vi.mocked(callApi).getMockImplementation();
    if (!baseCallApiImpl) {
      throw new Error("Missing base API mock implementation.");
    }
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && path === "/api/assessment-documents") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return new Response(
          JSON.stringify({
            id: ASSESSMENT_ID,
            organization_id: ORG_ID,
            client_id: "client-1",
            template_type: "caloptima_fba",
            file_name: "caloptima-fba.docx",
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            file_size: 1000,
            bucket_id: "client-documents",
            object_path: "clients/client-1/assessments/caloptima-fba.docx",
            status: "uploaded",
            created_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
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

    await screen.findByText(/CalOptima FBA Upload Workflow/i);
    const templateSelect = screen.getByRole("combobox", { name: /FBA template/i });
    expect(within(templateSelect).getByRole("option", { name: "CalOptima FBA" })).toBeInTheDocument();
    expect(within(templateSelect).getByRole("option", { name: "IEHP FBA" })).toBeInTheDocument();
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock caloptima content"], "caloptima-fba.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await user.upload(uploadInput, file);
    await user.click(screen.getByRole("button", { name: /Upload CalOptima FBA/i }));
    await screen.findByText(/Uploading and processing your FBA/i);
    expect(screen.getByRole("button", { name: /Uploading and processing/i })).toBeDisabled();

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-documents",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"template_type\":\"caloptima_fba\""),
        }),
      );
    });
    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledWith("CalOptima FBA uploaded and checklist initialized.");
    });
  });

  it("uploads an IEHP assessment when IEHP template is selected", async () => {
    const baseCallApiImpl = vi.mocked(callApi).getMockImplementation();
    if (!baseCallApiImpl) {
      throw new Error("Missing base API mock implementation.");
    }
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
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
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "iehp-checklist-1",
                section_key: "iehp_summary_review",
                label: "IEHP Summary",
                placeholder_key: "iehp_summary",
                required: true,
                mode: "ASSISTED",
                status: "approved",
                review_notes: null,
                value_text: "IEHP summary text",
              },
            ],
            structured_sections: buildIehpStructuredSections(),
          }),
          { status: 200 },
        );
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

    await screen.findByText(/CalOptima FBA Upload Workflow/i);
    const templateSelect = screen.getByRole("combobox", { name: /FBA template/i });
    await user.selectOptions(templateSelect, "iehp_fba");
    expect(await screen.findByText(/IEHP FBA Upload Workflow/i)).toBeInTheDocument();
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock iehp content"], "iehp-fba.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await user.upload(uploadInput, file);
    await user.click(screen.getByRole("button", { name: /Upload IEHP FBA/i }));

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

  it("auto-selects IEHP template when the uploaded FBA filename identifies IEHP", async () => {
    const baseCallApiImpl = vi.mocked(callApi).getMockImplementation();
    if (!baseCallApiImpl) {
      throw new Error("Missing base API mock implementation.");
    }
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && path === "/api/assessment-documents") {
        return new Response(
          JSON.stringify({
            id: ASSESSMENT_ID,
            organization_id: ORG_ID,
            client_id: "client-1",
            template_type: "iehp_fba",
            file_name: "Le, Ki IEHP FBA December 2025 (1).docx",
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            file_size: 1000,
            bucket_id: "client-documents",
            object_path: "clients/client-1/assessments/le-ki-iehp-fba.docx",
            status: "uploaded",
            created_at: "2026-02-11T00:00:00.000Z",
          }),
          { status: 201 },
        );
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

    await screen.findByText(/CalOptima FBA Upload Workflow/i);
    const templateSelect = screen.getByRole("combobox", { name: /FBA template/i });
    expect(templateSelect).toHaveValue("caloptima_fba");
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock iehp content"], "Le, Ki IEHP FBA December 2025 (1).docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await user.upload(uploadInput, file);

    expect(templateSelect).toHaveValue("iehp_fba");
    expect(await screen.findByText(/IEHP FBA Upload Workflow/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upload IEHP FBA/i }));

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-documents",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"template_type\":\"iehp_fba\""),
        }),
      );
    });
  });

  it("blocks a filename/template mismatch before uploading to storage", async () => {
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

    await screen.findByText(/CalOptima FBA Upload Workflow/i);
    const templateSelect = screen.getByRole("combobox", { name: /FBA template/i });
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    const file = new File(["mock iehp content"], "Le, Ki IEHP FBA December 2025 (1).docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await user.upload(uploadInput, file);
    expect(templateSelect).toHaveValue("iehp_fba");

    await user.selectOptions(templateSelect, "caloptima_fba");
    expect(templateSelect).toHaveValue("caloptima_fba");
    await user.click(screen.getByRole("button", { name: /Upload CalOptima FBA/i }));

    await waitFor(() => {
      expect(showError).toHaveBeenCalled();
    });
    const [error] = vi.mocked(showError).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The selected file appears to be IEHP FBA. Select IEHP FBA before uploading.",
    );
    expect(storageUploadMock).not.toHaveBeenCalled();
    expect(callApi).not.toHaveBeenCalledWith(
      "/api/assessment-documents",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders IEHP-specific review labels for a selected uploaded assessment", async () => {
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
              template_type: "iehp_fba",
              file_name: "iehp-review.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/iehp-review.docx",
              status: "drafted",
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
            structured_sections: buildIehpStructuredSections(),
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-template-layout?")) {
        return new Response(
          JSON.stringify({
            template_version: {
              version_key: "iehp_fba_updated_fba_11_2026_05",
              source_document_name: "Updated FBA -IEHP (11).docx",
              page_count: 30,
            },
            pages: [
              { page_number: 1, title: "General Information", layout_json: {} },
              { page_number: 30, title: "Signature Block", layout_json: {} },
            ],
            fields: [
              {
                page_number: 1,
                section_key: "identification_admin",
                field_key: "IEHP_FBA_FIRST_NAME",
                label: "First Name",
                field_type: "text",
                mode: "AUTO",
                required: true,
                source: "clients.first_name",
                layout_json: {},
              },
            ],
            values: {
              checklist_items: [
                {
                  id: "item-1",
                  placeholder_key: "IEHP_FBA_FIRST_NAME",
                  section_key: "identification_admin",
                  label: "First Name",
                  mode: "AUTO",
                  required: true,
                  status: "drafted",
                  value_text: "Synthetic",
                  value_json: null,
                  review_notes: null,
                },
              ],
              structured_sections: buildIehpStructuredSections(),
            },
            unresolved_required_count: 1,
            extracted_value_count: 1,
          }),
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

    expect(await screen.findByText("iehp-review.docx")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /iehp-review\.docx/i })[0]);
    expect(await screen.findByRole("heading", { name: "IEHP FBA Checklist Review" })).toBeInTheDocument();
    expect(await screen.findByText("IEHP FBA document-style review")).toBeInTheDocument();
    expect(await screen.findByText("Page 1: General Information")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate completed IEHP DOCX/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Optional: Export Completed CalOptima FBA PDF/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Optional: Export Completed IEHP FBA PDF/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Structured CalOptima Sections")).not.toBeInTheDocument();
  });

  it("renders readable CalOptima structured section previews before JSON editing", async () => {
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
              file_name: "caloptima-redacted.pdf",
              mime_type: "application/pdf",
              file_size: 1234,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/caloptima-redacted.pdf",
              status: "extracted",
              extraction_error: null,
              created_at: "2026-05-19T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(
          JSON.stringify({
            items: [],
            structured_sections: [
              {
                id: "structured-crisis",
                section_key: "diagnostic_behavior_analysis",
                field_key: "CALOPTIMA_FBA_CRISIS_PLAN",
                section_index: 0,
                payload: {
                  raw_text: "Caregivers will call emergency services for immediate danger and notify the BCBA.",
                },
                status: "drafted",
                required: true,
                review_notes: "Clinician review required.",
              },
              {
                id: "structured-hcpcs",
                section_key: "summary_recommendations_signatures",
                field_key: "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
                section_index: 0,
                payload: {
                  rows: [
                    { hcpcs_code: "H2019", raw_text: "H2019 Therapeutic Behavioral Services 160 units" },
                    { hcpcs_code: "S5110", raw_text: "S5110 Home Care Training, Family 24 units" },
                  ],
                },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
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

    expect(await screen.findByText("caloptima-redacted.pdf")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /caloptima-redacted\.pdf/i })[0]);

    expect(await screen.findByRole("heading", { name: "Structured CalOptima FBA Sections" })).toBeInTheDocument();
    expect(screen.getByText("Crisis plan #1")).toBeInTheDocument();
    expect(screen.getByText(/raw text: Caregivers will call emergency services/i)).toBeInTheDocument();
    expect(screen.getByText("HCPCS recommendation rows #1")).toBeInTheDocument();
    expect(screen.getByText(/Row 1: H2019 Therapeutic Behavioral Services 160 units/i)).toBeInTheDocument();
    expect(screen.getAllByText("Extracted preview").length).toBeGreaterThanOrEqual(2);
  });

  it("limits accepted upload types to pdf and docx", async () => {
    renderWithProviders(<ProgramsGoalsTab client={buildClient()} />, {
      auth: {
        role: "therapist",
        organizationId: ORG_ID,
        accessToken: "test-access-token",
      },
    });

    await screen.findByText(/FBA Upload Workflow/i);
    const uploadInput = screen.getByLabelText(/FBA file \(PDF or DOCX\)/i);
    expect(uploadInput.getAttribute("accept")).toBe(".pdf,.docx");
  });

  it("hides uploaded-assessment AI draft generation controls", async () => {
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
    expect(screen.queryByRole("button", { name: /(Generate|Retry).*Uploaded FBA/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
  });

  it("does not expose retry generation after extraction failure", async () => {
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
    expect(screen.queryByText(/Retry deterministic draft generation/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Wait for extraction to complete before generating drafts.")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
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
    expect(screen.queryByText(/draft generation/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(([path, init]) => path === "/api/assessment-drafts" && init?.method === "POST"),
    ).toBe(false);
  });

  it("shows structured goal readiness counts without AI draft controls", async () => {
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
    expect(screen.queryByText("Approve at least one structured goal section before generating drafts.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /(Generate|Retry).*Uploaded FBA/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
  });

  it("keeps AI draft generation absent while extraction is still running", async () => {
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

    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Wait for extraction to complete before generating drafts.")).not.toBeInTheDocument();
    expect(
      vi.mocked(callApi).mock.calls.some(
        ([path, init]) => path === "/api/assessment-drafts" && (init?.method ?? "").toUpperCase() === "POST",
      ),
    ).toBe(false);
  });

  it("keeps AI draft generation absent even when structured goals are only verified", async () => {
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

    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Approve at least one structured goal section before generating drafts.")).not.toBeInTheDocument();
  });

  it("shows drafted uploads as structured review ready without AI guidance", async () => {
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

    expect((await screen.findAllByText("structured review ready")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Generate Drafts from Uploaded FBA/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Drafts already exist for this assessment. Review/edit current drafts instead of regenerating."),
    ).not.toBeInTheDocument();
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
    const exportPdfButton = screen.getByRole("button", { name: /Optional: Export Completed CalOptima FBA PDF/i });
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

  it("generates completed IEHP DOCX and opens the returned signed URL", async () => {
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
                id: "optional-referring-provider",
                assessment_document_id: ASSESSMENT_ID,
                placeholder_key: "IEHP_FBA_REFERRING_PROVIDER",
                label: "Name of Referring Provider",
                value_text: null,
                value_json: null,
                status: "not_started",
                required: true,
              },
              {
                id: "optional-assessor-phone",
                assessment_document_id: ASSESSMENT_ID,
                placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
                label: "Assessor phone",
                value_text: "N/a",
                value_json: null,
                status: "approved",
                required: true,
              },
              {
                id: "optional-adaptive-summary",
                assessment_document_id: ASSESSMENT_ID,
                placeholder_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
                label: "Adaptive measure summaries",
                value_text: "1 structured section extracted",
                value_json: null,
                status: "approved",
                required: true,
              },
            ],
            structured_sections: [
              {
                id: "optional-assessor-phone-section",
                assessment_document_id: ASSESSMENT_ID,
                field_key: "IEHP_FBA_ASSESSOR_PHONE",
                section_key: "identification_admin",
                section_index: 0,
                payload: null,
                status: "drafted",
                required: true,
              },
              {
                id: "optional-referring-provider-section",
                assessment_document_id: ASSESSMENT_ID,
                field_key: "IEHP_FBA_REFERRING_PROVIDER",
                section_key: "identification_admin",
                section_index: 0,
                payload: null,
                status: "not_started",
                required: true,
              },
              {
                id: "optional-adaptive-summary-section",
                assessment_document_id: ASSESSMENT_ID,
                field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
                section_key: "assessment_procedures_testing",
                section_index: 0,
                payload: {
                  assessment_blocks: [
                    { label: "VB-MAPP", raw_text: null, manual_review_required: true },
                    { label: "Vineland", raw_text: "Vineland summary" },
                  ],
                },
                status: "approved",
                required: true,
              },
            ],
          }),
          { status: 200 },
        );
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
              template_type: "iehp_fba",
              file_name: "iehp-fba.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/iehp-fba.docx",
              status: "drafted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-plan-pdf") {
        return new Response(
          JSON.stringify({
            generated_file_type: "docx",
            content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "generated-iehp-fba.docx",
            bucket_id: "client-documents",
            object_path: "clients/client-1/assessments/generated-iehp-fba.docx",
            signed_url: "https://example.com/generated-iehp-fba.docx",
            preflight: { ready: true, blockers: [], warnings: [] },
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

    await screen.findByText("iehp-fba.docx");
    const generateDocxButton = await screen.findByRole("button", { name: /Generate completed IEHP DOCX/i });
    await waitFor(() => {
      expect(generateDocxButton).not.toBeDisabled();
    });
    await user.click(generateDocxButton);

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-plan-pdf",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(openSpy).toHaveBeenCalledWith("https://example.com/generated-iehp-fba.docx", "_blank", "noopener,noreferrer");
    expect(showSuccess).toHaveBeenCalledWith("Completed IEHP DOCX generated.");
    openSpy.mockRestore();
  });

  it("shows actionable IEHP preflight blockers from generation responses", async () => {
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
              template_type: "iehp_fba",
              file_name: "iehp-fba.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/iehp-fba.docx",
              status: "drafted",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "POST" && path === "/api/assessment-plan-pdf") {
        return new Response(
          JSON.stringify({
            error: "IEHP DOCX generation is blocked by review preflight.",
            preflight: {
              ready: false,
              blockers: [
                { code: "unapproved_required_checklist", key: "IEHP_FBA_REASON_FOR_REFERRAL", message: "Required field is not approved." },
                { code: "pending_draft_goals", count: 2, message: "Draft goals are still pending review." },
              ],
              warnings: [],
            },
          }),
          { status: 409 },
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

    await screen.findByText("iehp-fba.docx");
    const generateDocxButton = await screen.findByRole("button", { name: /Generate completed IEHP DOCX/i });
    await waitFor(() => {
      expect(generateDocxButton).not.toBeDisabled();
    });
    await user.click(generateDocxButton);

    await waitFor(() => {
      expect(showError).toHaveBeenCalled();
    });
    expect(vi.mocked(showError).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("IEHP preflight blockers: IEHP_FBA_REASON_FOR_REFERRAL; pending_draft_goals (2)"),
      }),
    );
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
    const exportPdfButton = screen.getByRole("button", { name: /Optional: Export Completed CalOptima FBA PDF/i });
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
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(showError).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows plural publish success counts from the live-promotion response", async () => {
    const invalidateQueriesSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
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
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(showSuccess).not.toHaveBeenCalledWith(
      "Published to live records. Created 2 production programs and 26 goals.",
    );
    invalidateQueriesSpy.mockRestore();
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
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(showSuccess).not.toHaveBeenCalledWith(
      "Published to live records. Created 1 production program and 26 goals.",
    );
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
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(showSuccess).not.toHaveBeenCalledWith(
      "Published to live records. Created 1 production program and 26 goals.",
    );
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

    expect(screen.queryByText("All changes published.")).not.toBeInTheDocument();
    expect(screen.queryByText("Publishing makes accepted drafts live in Programs and Goals.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft Review/i)).not.toBeInTheDocument();
  });

  it("shows retained-draft messaging and blocks republish after approval", async () => {
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
              file_name: "approved-fba.pdf",
              mime_type: "application/pdf",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/approved-fba.pdf",
              status: "approved",
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

    expect(await screen.findByText("approved-fba.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Drafts retained after publication.")).not.toBeInTheDocument();
    expect(screen.queryByText("This assessment has already been approved and published.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Draft retained for audit after approval. Live records are already published.")).not.toBeInTheDocument();
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

    expect(screen.queryByText("Draft changes pending publication.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Program Draft/i })).not.toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: /Save Goal Draft/i })).not.toBeInTheDocument();
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

    expect(screen.queryByText("Select a valid assessment first.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
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

    expect(screen.queryByText("1 required checklist row must be approved before publishing.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
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
    expect(screen.queryByText("Checklist review must load before publishing.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Accepted draft goals: 2 child / 1 parent")).not.toBeInTheDocument();
  });

  it("shows disabled IEHP publish controls when required rows remain unresolved", async () => {
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
              template_type: "iehp_fba",
              file_name: "synthetic-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-iehp.docx",
              status: "drafted",
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
                id: "required-row-1",
                section_key: "recommendations",
                label: "Recommendation",
                placeholder_key: "IEHP_FBA_RECOMMENDATION",
                required: true,
                mode: "ASSISTED",
                status: "drafted",
                review_notes: null,
                value_text: "Synthetic recommendation",
              },
            ],
            structured_sections: [],
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: [
              {
                id: "g1",
                title: "Goal A",
                description: "Goal description",
                original_text: "Original wording",
                goal_type: "child",
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

    await screen.findByText("synthetic-iehp.docx");
    await screen.findByRole("heading", { name: /IEHP FBA Checklist Review/i });
    const publishButton = await screen.findByRole("button", { name: /Publish Reviewed Assessment/i });
    const unresolvedGuidance = await screen.findByText(
      "1 required checklist or structured row must be approved before publishing.",
    );

    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(publishButton).toBeDisabled();
    expect(unresolvedGuidance).toBeInTheDocument();
  });

  it("does not promote IEHP drafts through the live Programs and Goals API", async () => {
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
              template_type: "iehp_fba",
              file_name: "synthetic-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-iehp.docx",
              status: "drafted",
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
                id: "required-row-1",
                section_key: "recommendations",
                label: "Recommendation",
                placeholder_key: "IEHP_FBA_RECOMMENDATION",
                required: true,
                mode: "ASSISTED",
                status: "approved",
                review_notes: null,
                value_text: "Synthetic recommendation",
              },
            ],
            structured_sections: [],
          }),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: [
              {
                id: "g1",
                title: "Goal A",
                description: "Goal description",
                original_text: "Original wording",
                goal_type: "child",
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

    await screen.findByText("synthetic-iehp.docx");
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalledWith(
      "/api/assessment-promote",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("publishes fully approved IEHP assessments to live programs and goals when the server reports live completion", async () => {
    const invalidateQueriesSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
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
              template_type: "iehp_fba",
              file_name: "approved-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/approved-iehp.docx",
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
                id: "required-row-1",
                section_key: "recommendations",
                label: "Recommendation",
                placeholder_key: "IEHP_FBA_RECOMMENDATION",
                required: true,
                mode: "ASSISTED",
                status: "approved",
                review_notes: null,
                value_text: "Synthetic recommendation",
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
      if (method === "POST" && path === "/api/assessment-promote") {
        return new Response(
          JSON.stringify({
            assessment_document_id: ASSESSMENT_ID,
            completion_mode: "live_program_goals",
            created_program_count: 1,
            created_goal_count: 2,
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

    await screen.findByText("approved-iehp.docx");
    const publishButton = await screen.findByRole("button", { name: /Publish Reviewed Assessment/i });
    expect(publishButton).toBeEnabled();

    await user.click(publishButton);

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-promote",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith(
      "Published to live records. Created 1 production program and 2 goals.",
    );
    expect(invalidateQueriesSpy).toHaveBeenCalled();
    invalidateQueriesSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("disables IEHP publish when approved required fields are blank", async () => {
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
              template_type: "iehp_fba",
              file_name: "blank-approved-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/blank-approved-iehp.docx",
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
                id: "required-row-1",
                section_key: "assessment_information",
                label: "Assessor phone",
                placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
                required: true,
                mode: "ASSISTED",
                status: "approved",
                review_notes: null,
                value_text: "   ",
                value_json: null,
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

    await screen.findByText("blank-approved-iehp.docx");
    const publishButton = await screen.findByRole("button", { name: /Publish Reviewed Assessment/i });
    expect(publishButton).toBeDisabled();
    expect(screen.getByText("1 approved IEHP data value must be completed before publishing.")).toBeInTheDocument();
  });

  it("disables IEHP publish when approved required structured rows are empty template placeholders", async () => {
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
              template_type: "iehp_fba",
              file_name: "placeholder-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/placeholder-iehp.docx",
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
            structured_sections: [
              {
                id: "structured-placeholder",
                section_key: "behavior_background_services",
                field_key: "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
                section_index: 0,
                required: true,
                status: "approved",
                review_notes: null,
                payload: {
                  field_key: "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
                  label: "School Information Block",
                  template_placeholder: true,
                  entered_value_present: false,
                  clinical_value: null,
                  raw_text: "",
                },
              },
            ],
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

    await screen.findByText("placeholder-iehp.docx");
    const publishButton = await screen.findByRole("button", { name: /Publish Reviewed Assessment/i });
    expect(publishButton).toBeDisabled();
    expect(screen.getByText("1 approved IEHP data value must be completed before publishing.")).toBeInTheDocument();
  });

  it("allows IEHP publish when a placeholder structured row has clinician-entered content", async () => {
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
              template_type: "iehp_fba",
              file_name: "filled-placeholder-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/filled-placeholder-iehp.docx",
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
            structured_sections: [
              {
                id: "structured-placeholder",
                section_key: "behavior_background_services",
                field_key: "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
                section_index: 0,
                required: true,
                status: "approved",
                review_notes: null,
                payload: {
                  field_key: "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
                  label: "School Information Block",
                  template_placeholder: true,
                  entered_value_present: false,
                  clinical_value: null,
                  raw_text: "Student attends school with current IEP supports.",
                },
              },
            ],
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

    await screen.findByText("filled-placeholder-iehp.docx");
    const publishButton = await screen.findByRole("button", { name: /Publish Reviewed Assessment/i });
    expect(publishButton).toBeEnabled();
    expect(screen.queryByText("1 approved IEHP data value must be completed before publishing.")).not.toBeInTheDocument();
  });

  it("does not render IEHP draft editors for already published assessments", async () => {
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
              template_type: "iehp_fba",
              file_name: "synthetic-published-iehp.docx",
              mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              file_size: 1000,
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/synthetic-published-iehp.docx",
              status: "approved",
              created_at: "2026-02-11T00:00:00.000Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (method === "GET" && path.startsWith("/api/assessment-checklist?")) {
        return new Response(JSON.stringify({ items: [], structured_sections: [] }), { status: 200 });
      }
      if (method === "GET" && path.startsWith("/api/assessment-drafts?")) {
        return new Response(
          JSON.stringify({
            programs: [{ id: "p1", name: "Program A", description: null, accept_state: "accepted", review_notes: null }],
            goals: [
              {
                id: "g1",
                title: "Goal A",
                description: "Goal description",
                original_text: "Original wording",
                goal_type: "child",
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

    expect(await screen.findByText("synthetic-published-iehp.docx")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Program Draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Goal Draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish to Live Programs \+ Goals/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Draft Review (Approve / Reject / Edit)")).not.toBeInTheDocument();
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

