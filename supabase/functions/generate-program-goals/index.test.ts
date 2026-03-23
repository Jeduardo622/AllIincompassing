import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { __TESTING__ } from "./index.ts";

const buildValidResponse = () => {
  const programs = [
    {
      name: "Communication Program",
      description: "Program description grounded in uploaded FBA evidence.",
      rationale: "Program rationale tied to communication deficits and replacement behavior strategy.",
      evidence_refs: [{ section_key: "assessment_summary", source_span: "Client demonstrates limited functional communication." }],
      review_flags: [],
    },
  ];

  const childGoals = Array.from({ length: 20 }, (_, index) => ({
    program_name: "Communication Program",
    title: `Child Goal ${index + 1} Functional Communication`,
    description: `Child goal description ${index + 1}`,
    original_text: `Original text ${index + 1} with measurable detail`,
    goal_type: "child" as const,
    target_behavior: "Functional communication response",
    measurement_type: "Frequency per opportunity",
    baseline_data: "Baseline currently below expected level.",
    target_criteria: "Target 80 percent opportunities.",
    mastery_criteria: "Mastery 85 percent across three sessions.",
    maintenance_criteria: "Maintenance 80 percent across probes.",
    generalization_criteria: "Generalize across home and clinic.",
    objective_data_points: ["Track independent manding frequency", "Track prompt level per trial"],
    rationale: "Derived directly from source evidence and conservative criteria.",
    evidence_refs: [{ section_key: "goals_treatment_planning", source_span: "Skill acquisition recommendation for communication." }],
    review_flags: [],
  }));

  const parentGoals = Array.from({ length: 6 }, (_, index) => ({
    program_name: "Communication Program",
    title: `Parent Goal ${index + 1} Implementation Fidelity`,
    description: `Parent goal description ${index + 1}`,
    original_text: `Parent original text ${index + 1} with measurable detail`,
    goal_type: "parent" as const,
    target_behavior: "Caregiver implementation fidelity",
    measurement_type: "Percent of steps completed",
    baseline_data: "Baseline fidelity is inconsistent.",
    target_criteria: "Target 80 percent fidelity.",
    mastery_criteria: "Mastery 85 percent fidelity across three sessions.",
    maintenance_criteria: "Maintenance 80 percent fidelity across probes.",
    generalization_criteria: "Generalize across routines and settings.",
    objective_data_points: ["Score caregiver fidelity checklist", "Record implementation opportunities completed"],
    rationale: "Parent training target supported by caregiver implementation needs.",
    evidence_refs: [{ section_key: "parent_training", source_span: "Caregiver coaching recommended in FBA." }],
    review_flags: [],
  }));

  return {
    programs,
    goals: [...childGoals, ...parentGoals],
    summary_rationale: "Overall plan targets communication and caregiver fidelity from uploaded FBA evidence.",
    confidence: "medium" as const,
  };
};

Deno.test("parseAndValidateCandidate accepts valid structured output", () => {
  const candidate = JSON.stringify(buildValidResponse());
  const result = __TESTING__.parseAndValidateCandidate(candidate);
  assertEquals(result.ok, true);
});

Deno.test("parseAndValidateCandidate rejects missing evidence_refs", () => {
  const payload = buildValidResponse();
  payload.goals[0].evidence_refs = [];
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "schema_validation");
  }
});

Deno.test("parseAndValidateCandidate enforces weak evidence review flags", () => {
  const payload = buildValidResponse();
  payload.goals[0].evidence_refs = [{ section_key: "unknown_section", source_span: "short evidence" }];
  payload.goals[0].review_flags = [];
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "weak_evidence_missing_flags");
  }
});

Deno.test("parseAndValidateCandidate rejects child parent mix mismatch", () => {
  const payload = buildValidResponse();
  payload.goals = payload.goals.filter((goal) => goal.goal_type !== "parent");
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "goal_mix_mismatch");
  }
});

Deno.test("parseAndValidateCandidate rejects duplicate goal titles", () => {
  const payload = buildValidResponse();
  payload.goals[1].title = payload.goals[0].title;
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "duplicate_goal_titles");
  }
});

Deno.test("parseAndValidateCandidate rejects duplicate program names", () => {
  const payload = buildValidResponse();
  payload.programs.push({
    ...payload.programs[0],
    name: "communication program",
  });
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "duplicate_program_names");
  }
});

Deno.test("parseAndValidateCandidate rejects missing_program_match goals", () => {
  const payload = buildValidResponse();
  payload.goals[0].program_name = "Unknown Program";
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "missing_program_match");
  }
});

Deno.test("buildFallbackResponse remains schema-compliant and fully flagged", () => {
  const requestPayload = __TESTING__.requestSchema.parse({
    assessment_document_id: "11111111-1111-4111-8111-111111111111",
    client_id: "22222222-2222-4222-8222-222222222222",
    organization_id: "33333333-3333-4333-8333-333333333333",
    client_display_name: "Client One",
    organization_guidance: "Use objective ABA language.",
    approved_checklist_rows: [
      {
        section_key: "assessment_summary",
        label: "Summary",
        value_text: "Client presents with communication deficits.",
        value_json: null,
      },
    ],
    extracted_canonical_fields: {},
    assessment_summary: "Client presents with communication deficits.",
    source_evidence_snippets: [
      {
        section_key: "assessment_summary",
        snippet: "Client presents with communication deficits.",
      },
    ],
  });
  const fallback = __TESTING__.buildFallbackResponse(requestPayload, "timeout");
  const schemaResult = __TESTING__.responseSchema.safeParse(fallback);
  assertEquals(schemaResult.success, true);
  assertEquals(fallback.confidence, "low");
  assertEquals(fallback.programs.length > 0, true);
  assertEquals(fallback.goals.length > 0, true);
  assertEquals(fallback.programs.every((program) => program.evidence_refs.length > 0), true);
  assertEquals(fallback.goals.every((goal) => goal.evidence_refs.length > 0), true);
  assertEquals(fallback.goals.every((goal) => goal.review_flags.includes("clinician_confirmation_needed")), true);
});
