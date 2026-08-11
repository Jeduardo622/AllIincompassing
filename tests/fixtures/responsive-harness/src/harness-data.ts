import type {
  Client,
  Goal,
  GoalDomain,
  GoalTarget,
  GoalTargetPhaseCriterion,
  Program,
  ProgramNote,
  Session,
  Therapist,
  TrialEvent,
} from "../../../../src/types";

export const HARNESS_ORG_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
export const HARNESS_CLIENT_ID = "test-client";
export const HARNESS_PROGRAM_ID = "program-communication";
export const HARNESS_GOAL_ID = "goal-functional-requests";
export const HARNESS_TARGET_ID = "target-request-break";

export const harnessClient: Client = {
  id: HARNESS_CLIENT_ID,
  email: "client.synthetic@example.test",
  full_name: "Test Client",
  date_of_birth: "2017-05-01",
  insurance_info: {},
  service_preference: ["ABA"],
  one_to_one_units: 20,
  supervision_units: 4,
  parent_consult_units: 2,
  assessment_units: 0,
  auth_units: 26,
  availability_hours: {
    monday: { start: "08:00", end: "16:00" },
    tuesday: { start: "08:00", end: "16:00" },
    wednesday: { start: "08:00", end: "16:00" },
    thursday: { start: "08:00", end: "16:00" },
    friday: { start: "08:00", end: "16:00" },
  },
  organization_id: HARNESS_ORG_ID,
  created_at: "2026-08-11T00:00:00.000Z",
};

export const harnessPrograms: Program[] = [
  {
    id: HARNESS_PROGRAM_ID,
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    name: "Communication",
    description: "Functional communication goals across home and clinic settings.",
    status: "active",
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessGoals: Goal[] = [
  {
    id: HARNESS_GOAL_ID,
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    program_id: HARNESS_PROGRAM_ID,
    domain_id: "domain-communication",
    title: "Increase functional requests",
    description: "Client requests preferred items and breaks with reduced prompting.",
    original_text: "Request preferred items and breaks independently in natural routines.",
    clinical_goal_type: "skill",
    measurement_type: "percent opportunities",
    baseline_data: "2 independent requests per session",
    target_criteria: "Request in 4/5 opportunities",
    mastery_criteria: "80% across three sessions",
    maintenance_criteria: "70% after four weeks",
    generalization_criteria: "Across two settings and two adults",
    teaching_strategies: "NET, visual supports, prompt fading",
    operational_definition: "Independent request within 5 seconds of EO",
    objective_data_points: [{ objective: "Request break", data_settings: "Prompt level" }],
    source: "manual",
    status: "active",
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessGoalDomains: GoalDomain[] = [
  {
    id: "domain-communication",
    organization_id: HARNESS_ORG_ID,
    name: "Communication",
    description: "Synthetic harness domain",
    status: "active",
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessTargets: GoalTarget[] = [
  {
    id: HARNESS_TARGET_ID,
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    goal_id: HARNESS_GOAL_ID,
    name: "Request a break",
    measurement_type: "correctIncorrect",
    graph_config: {},
    status: "active",
    sort_order: 0,
    current_phase: "teaching",
    is_current: true,
    evaluation_window_started_at: "2026-08-11T00:00:00.000Z",
    progression_version: 1,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessCriteria: GoalTargetPhaseCriterion[] = [
  {
    id: "criterion-baseline",
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    goal_id: HARNESS_GOAL_ID,
    target_id: HARNESS_TARGET_ID,
    phase: "baseline",
    metric: "percent_correct",
    comparator: "gte",
    threshold: 60,
    min_observations: 4,
    consecutive_sessions: 2,
    clinical_note: null,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
  {
    id: "criterion-teaching",
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    goal_id: HARNESS_GOAL_ID,
    target_id: HARNESS_TARGET_ID,
    phase: "teaching",
    metric: "percent_correct",
    comparator: "gte",
    threshold: 80,
    min_observations: 5,
    consecutive_sessions: 3,
    clinical_note: null,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessTrialEvents: TrialEvent[] = [
  {
    id: "trial-1",
    organization_id: HARNESS_ORG_ID,
    client_id: HARNESS_CLIENT_ID,
    session_id: "session-1",
    target_id: HARNESS_TARGET_ID,
    goal_id: HARNESS_GOAL_ID,
    therapist_id: "therapist-1",
    trial_number: 1,
    response: "correct",
    event_timestamp: "2026-08-11T15:00:00.000Z",
    metadata: {},
    created_at: "2026-08-11T15:00:00.000Z",
    updated_at: "2026-08-11T15:00:00.000Z",
  },
];

export const harnessProgramNotes: ProgramNote[] = [
  {
    id: "note-1",
    organization_id: HARNESS_ORG_ID,
    program_id: HARNESS_PROGRAM_ID,
    note_type: "plan_update",
    content: { text: "Synthetic note: focus on generalizing requests across transitions." },
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  },
];

export const harnessTherapists: Therapist[] = [
  {
    id: "therapist-1",
    email: "therapist.synthetic@example.test",
    full_name: "Taylor Therapist",
    organization_id: HARNESS_ORG_ID,
    specialties: ["Communication"],
    max_clients: 4,
    service_type: ["ABA"],
    weekly_hours_min: 10,
    weekly_hours_max: 30,
    availability_hours: {
      monday: { start: "09:00", end: "17:00" },
      tuesday: { start: "09:00", end: "17:00" },
      wednesday: { start: "09:00", end: "17:00" },
      thursday: { start: "09:00", end: "17:00" },
      friday: { start: "09:00", end: "17:00" },
    },
    created_at: "2026-08-11T00:00:00.000Z",
    latitude: 33.7455,
    longitude: -117.8677,
  },
];

export const harnessScheduleClients: Client[] = [
  {
    ...harnessClient,
    latitude: 33.7545,
    longitude: -117.8700,
    authorized_hours_per_month: 20,
    hours_provided_per_month: 10,
  },
];

export const harnessExistingSessions: Session[] = [];
