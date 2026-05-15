import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("OPENAI_API_KEY", "test-openai-key");

const { __TESTING__ } = await import("./index.ts");

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

Deno.test("parseAndValidateCandidate accepts responses above the legacy program and goal caps", () => {
  const payload = {
    programs: Array.from({ length: 7 }, (_, index) => ({
      name: `Program ${index + 1}`,
      description: `Program description ${index + 1} grounded in uploaded FBA evidence and clinical implementation details.`,
      rationale: `Program rationale ${index + 1} tied to documented source evidence and replacement skill planning.`,
      evidence_refs: [{
        section_key: "assessment_summary",
        source_span: `Evidence for program ${index + 1} with enough detail to satisfy evidence validation requirements.`,
      }],
      review_flags: [],
    })),
    goals: Array.from({ length: 28 }, (_, index) => ({
      program_name: `Program ${(index % 7) + 1}`,
      title: `Expanded Goal ${index + 1}`,
      description: `Expanded goal description ${index + 1} with enough detail for validation and implementation.`,
      original_text: `Expanded original text ${index + 1} with measurable detail and direct assessment grounding.`,
      goal_type: index < 21 ? "child" as const : "parent" as const,
      target_behavior: index < 21 ? "Functional communication response" : "Caregiver implementation fidelity",
      measurement_type: "Frequency per opportunity",
      baseline_data: "Baseline currently below expected level and documented in source evidence.",
      target_criteria: "Target 80 percent opportunities across clearly defined sessions.",
      mastery_criteria: "Mastery 85 percent across three consecutive sessions.",
      maintenance_criteria: "Maintenance 80 percent across scheduled probes.",
      generalization_criteria: "Generalize across home, clinic, and caregiver routines.",
      objective_data_points: ["Track independent response count", "Track prompt level for each opportunity"],
      rationale: `Expanded rationale ${index + 1} derived directly from assessment evidence and conservative clinical drafting.`,
      evidence_refs: [{
        section_key: "goals_treatment_planning",
        source_span: `Expanded supporting evidence ${index + 1} with enough detail to satisfy evidence validation requirements.`,
      }],
      review_flags: [],
    })),
    summary_rationale: "Overall plan targets the full supported set of programs and goals from uploaded FBA evidence.",
    confidence: "medium" as const,
  };
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, true);
});

Deno.test("parseAndValidateCandidate accepts smaller valid goal sets after legacy floor removal", () => {
  const payload = {
    programs: [
      {
        name: "Communication Program",
        description: "Program description grounded in uploaded FBA evidence and clinical implementation details.",
        rationale: "Program rationale tied to documented source evidence and replacement skill planning.",
        evidence_refs: [{
          section_key: "assessment_summary",
          source_span: "Evidence for program with enough detail to satisfy evidence validation requirements.",
        }],
        review_flags: [],
      },
    ],
    goals: [
      {
        program_name: "Communication Program",
        title: "Child Goal 1",
        description: "Expanded child goal description with enough detail for validation and implementation.",
        original_text: "Expanded child original text with measurable detail and direct assessment grounding.",
        goal_type: "child" as const,
        target_behavior: "Functional communication response",
        measurement_type: "Frequency per opportunity",
        baseline_data: "Baseline currently below expected level and documented in source evidence.",
        target_criteria: "Target 80 percent opportunities across clearly defined sessions.",
        mastery_criteria: "Mastery 85 percent across three consecutive sessions.",
        maintenance_criteria: "Maintenance 80 percent across scheduled probes.",
        generalization_criteria: "Generalize across home, clinic, and caregiver routines.",
        objective_data_points: ["Track independent response count", "Track prompt level for each opportunity"],
        rationale: "Expanded rationale derived directly from assessment evidence and conservative clinical drafting.",
        evidence_refs: [{
          section_key: "goals_treatment_planning",
          source_span: "Expanded supporting evidence with enough detail to satisfy evidence validation requirements.",
        }],
        review_flags: [],
      },
      {
        program_name: "Communication Program",
        title: "Parent Goal 1",
        description: "Expanded parent goal description with enough detail for validation and implementation.",
        original_text: "Expanded parent original text with measurable detail and direct assessment grounding.",
        goal_type: "parent" as const,
        target_behavior: "Caregiver implementation fidelity",
        measurement_type: "Frequency per opportunity",
        baseline_data: "Baseline currently below expected level and documented in source evidence.",
        target_criteria: "Target 80 percent opportunities across clearly defined sessions.",
        mastery_criteria: "Mastery 85 percent across three consecutive sessions.",
        maintenance_criteria: "Maintenance 80 percent across scheduled probes.",
        generalization_criteria: "Generalize across home, clinic, and caregiver routines.",
        objective_data_points: ["Track independent response count", "Track prompt level for each opportunity"],
        rationale: "Expanded rationale derived directly from assessment evidence and conservative clinical drafting.",
        evidence_refs: [{
          section_key: "parent_training",
          source_span: "Expanded supporting evidence with enough detail to satisfy evidence validation requirements.",
        }],
        review_flags: [],
      },
    ],
    summary_rationale: "Overall plan targets the supported smaller set of programs and goals from uploaded FBA evidence.",
    confidence: "medium" as const,
  };
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, true);
});

Deno.test("parseAndValidateCandidate rejects responses above the non-legacy program ceiling", () => {
  const payload = buildValidResponse();
  payload.programs = Array.from({ length: 51 }, (_, index) => ({
    ...payload.programs[0],
    name: `Program ${index + 1}`,
  }));
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "schema_validation");
  }
});

Deno.test("parseAndValidateCandidate rejects responses above the non-legacy goal ceiling", () => {
  const payload = buildValidResponse();
  payload.goals = Array.from({ length: 501 }, (_, index) => ({
    ...payload.goals[index % payload.goals.length],
    title: `Goal ${index + 1}`,
  }));
  const result = __TESTING__.parseAndValidateCandidate(JSON.stringify(payload));
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "schema_validation");
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
        placeholder_key: "assessment_summary",
        value_text: "Client presents with communication deficits.",
        value_json: {},
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
