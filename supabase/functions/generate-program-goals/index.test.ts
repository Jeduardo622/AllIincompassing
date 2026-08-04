import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("OPENAI_API_KEY", "test-openai-key");

const generationModule = await import("./index.ts");
const { __TESTING__ } = generationModule;
const createGenerateProgramGoalsHandler = (generationModule as Record<string, unknown>).createGenerateProgramGoalsHandler as
  | ((dependencies?: Record<string, unknown>) => (req: Request) => Promise<Response>)
  | undefined;

const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG_ID = "99999999-9999-4999-8999-999999999999";

const buildLegacyRequest = (overrides: Partial<Record<string, unknown>> = {}) => ({
  assessment_document_id: ASSESSMENT_ID,
  client_id: CLIENT_ID,
  organization_id: ORG_ID,
  client_display_name: "Client One",
  organization_guidance: "Use objective ABA language.",
  approved_checklist_rows: [
    {
      section_key: "assessment_summary",
      label: "Summary",
      placeholder_key: "assessment_summary",
      value_text: "Approved summary text.",
    },
  ],
  extracted_canonical_fields: {
    CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS: "Replacement goals",
  },
  assessment_summary: "Synthetic assessment text with sufficient detail.",
  source_evidence_snippets: [
    {
      section_key: "assessment_summary",
      snippet: "Approved evidence snippet.",
    },
  ],
  ...overrides,
});

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

Deno.test("ledger replay is bound to the original canonical output hash", async () => {
  const packet = buildValidResponse();
  const expectedHash = await (await import("./ledger.ts")).hashLedgerModelOutput(packet);
  assertEquals(await __TESTING__.verifyLedgerReplayPacket(packet, expectedHash, expectedHash, expectedHash), packet);
  await assertRejects(
    () => __TESTING__.verifyLedgerReplayPacket(packet, expectedHash, "0".repeat(64), expectedHash),
    Error,
    "persisted_draft_packet_hash_mismatch",
  );
});

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

Deno.test("ledger generation accepts only fixed server-issued correlation fields", () => {
  const valid = {
    assessmentDocumentId: "11111111-1111-4111-8111-111111111111",
    organizationId: "33333333-3333-4333-8333-333333333333",
    clientId: "22222222-2222-4222-8222-222222222222",
    workItemId: "44444444-4444-4444-8444-444444444444",
    correlationId: "caloptima.test.1",
  };

  assertEquals(__TESTING__.ledgerGenerationSchema.safeParse(valid).success, true);
  assertEquals(__TESTING__.ledgerGenerationSchema.safeParse({
    ...valid,
    approved_checklist_rows: [{ value_text: "caller supplied evidence" }],
  }).success, false);
  assertEquals(__TESTING__.ledgerGenerationSchema.safeParse({
    ...valid,
    completion: "approved",
  }).success, false);
  assertEquals(__TESTING__.ledgerGenerationSchema.safeParse({
    ...valid,
    tools: ["assessment-promote"],
  }).success, false);
});

Deno.test("resolveGenerationRequest classifies valid legacy input", () => {
  const resolveGenerationRequest = (__TESTING__ as Record<string, unknown>).resolveGenerationRequest as
    | ((body: unknown, organizationId: string) => unknown)
    | undefined;
  assertExists(resolveGenerationRequest);
  assertEquals(resolveGenerationRequest(buildLegacyRequest(), ORG_ID), {
    kind: "legacy",
    payload: {
      ...buildLegacyRequest(),
      approved_checklist_rows: [
        {
          ...buildLegacyRequest().approved_checklist_rows[0],
          source_span: "unbound-source",
        },
      ],
      source_evidence_snippets: [
        {
          ...buildLegacyRequest().source_evidence_snippets[0],
          source_span: "unbound-source",
        },
      ],
    },
  });
});

Deno.test("resolveGenerationRequest denies cross-tenant legacy input", () => {
  const resolveGenerationRequest = (__TESTING__ as Record<string, unknown>).resolveGenerationRequest as
    | ((body: unknown, organizationId: string) => unknown)
    | undefined;
  assertExists(resolveGenerationRequest);
  assertEquals(
    resolveGenerationRequest({ ...buildLegacyRequest(), organization_id: OTHER_ORG_ID }, ORG_ID),
    {
      kind: "error",
      status: 403,
      code: "generation_scope_denied",
      binding: "legacy",
    },
  );
});

Deno.test("resolveGenerationRequest rejects malformed request bodies", () => {
  const resolveGenerationRequest = (__TESTING__ as Record<string, unknown>).resolveGenerationRequest as
    | ((body: unknown, organizationId: string) => unknown)
    | undefined;
  assertExists(resolveGenerationRequest);
  assertEquals(resolveGenerationRequest({ unexpected: true }, ORG_ID), {
    kind: "error",
    status: 400,
    code: "invalid_request_body",
  });
});

Deno.test("ledger model completion request explicitly disables every tool", () => {
  const request = __TESTING__.buildCompletionRequest("Synthetic prompt", true);
  assertEquals(request.model, "gpt-4o");
  assertEquals(request.temperature, 0.1);
  assertEquals(request.tools, []);
  assertEquals(request.messages[1], { role: "user", content: "Synthetic prompt" });
});

Deno.test("ledger generation snapshots fixed versions before returning authoritative input", async () => {
  const calls: string[] = [];
  const correlation = __TESTING__.ledgerGenerationSchema.parse({
    assessmentDocumentId: "11111111-1111-4111-8111-111111111111",
    organizationId: "33333333-3333-4333-8333-333333333333",
    clientId: "22222222-2222-4222-8222-222222222222",
    workItemId: "44444444-4444-4444-8444-444444444444",
    correlationId: "caloptima.test.2",
  });
  const authoritativePayload = __TESTING__.requestSchema.parse({
    assessment_document_id: correlation.assessmentDocumentId,
    client_id: correlation.clientId,
    organization_id: correlation.organizationId,
    client_display_name: "",
    organization_guidance: "",
    approved_checklist_rows: [{
      section_key: "treatment",
      label: "Approved treatment evidence",
      placeholder_key: "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
      value_text: "Synthetic approved evidence for a draft-only candidate.",
      value_json: {},
    }],
    extracted_canonical_fields: { approved_goal_count: 1 },
    assessment_summary: "Synthetic approved evidence for a draft-only candidate.",
    source_evidence_snippets: [{
      section_key: "treatment",
      snippet: "Synthetic approved evidence for a draft-only candidate.",
    }],
  });

  const prepared = await __TESTING__.prepareLedgerGeneration({
    actorUserId: "77777777-7777-4777-8777-777777777777",
    requestId: "request.caloptima.1",
    correlation,
  }, {
    loadAuthoritativePayload: async (input: unknown) => {
      calls.push("load");
      assertEquals(input, {
        actorUserId: "77777777-7777-4777-8777-777777777777",
        assessmentDocumentId: correlation.assessmentDocumentId,
        organizationId: correlation.organizationId,
        clientId: correlation.clientId,
      });
      return authoritativePayload;
    },
    beginAttempt: async (input: Record<string, unknown>) => {
      calls.push("begin");
      assertEquals(input.provider, "openai");
      assertEquals(input.model, "gpt-4o");
      assertEquals(input.promptVersion, "caloptima-draft-review.prompt.v1");
      assertEquals(input.toolVersion, "caloptima-draft-review.no-tools.v1");
      assertEquals(input.modelRequestSchemaVersion, "caloptima-draft-review.response.v1");
      assertEquals(input.allowedTools, []);
      return {
        authoritative: true,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      };
    },
    settleAttemptFailure: async () => {
      throw new Error("unexpected_settlement");
    },
  });

  assertEquals(calls, ["begin", "load"]);
  assertEquals(prepared.payload, authoritativePayload);
  assertEquals(prepared.authoritative, true);
  assertEquals(prepared.canTransitionWorkflow, false);
  assertEquals(prepared.canPublish, false);
});

Deno.test("ledger generation fails closed on scope mismatch or denied snapshot", async () => {
  const correlation = __TESTING__.ledgerGenerationSchema.parse({
    assessmentDocumentId: "11111111-1111-4111-8111-111111111111",
    organizationId: "33333333-3333-4333-8333-333333333333",
    clientId: "22222222-2222-4222-8222-222222222222",
    workItemId: "44444444-4444-4444-8444-444444444444",
    correlationId: "caloptima.test.3",
  });
  const mismatched = __TESTING__.requestSchema.parse({
    assessment_document_id: correlation.assessmentDocumentId,
    client_id: "88888888-8888-4888-8888-888888888888",
    organization_id: correlation.organizationId,
    client_display_name: "",
    organization_guidance: "",
    approved_checklist_rows: [],
    extracted_canonical_fields: {},
    assessment_summary: "Synthetic approved evidence with enough characters.",
    source_evidence_snippets: [{
      section_key: "treatment",
      snippet: "Synthetic approved evidence with enough characters.",
    }],
  });

  await assertRejects(
    () => __TESTING__.prepareLedgerGeneration({
      actorUserId: "77777777-7777-4777-8777-777777777777",
      requestId: "request.caloptima.2",
      correlation,
    }, {
      loadAuthoritativePayload: async () => mismatched,
      beginAttempt: async () => ({
        authoritative: true,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      }),
      settleAttemptFailure: async () => {},
    }),
    Error,
    "authoritative_scope_mismatch",
  );

  await assertRejects(
    () => __TESTING__.prepareLedgerGeneration({
      actorUserId: "77777777-7777-4777-8777-777777777777",
      requestId: "request.caloptima.3",
      correlation,
    }, {
      loadAuthoritativePayload: async () => ({ ...mismatched, client_id: correlation.clientId }),
      beginAttempt: async () => ({
        authoritative: false,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      }),
      settleAttemptFailure: async () => {},
    }),
    Error,
    "attempt_snapshot_denied",
  );
});

Deno.test("ledger generation requires the stable work-item request identity", async () => {
  assertEquals(
    __TESTING__.deriveStableLedgerRequestId("44444444-4444-4444-8444-444444444444"),
    "caloptima-ledger.44444444-4444-4444-8444-444444444444",
  );
});

Deno.test("structured evidence uses approved payload content instead of locator metadata", () => {
  assertEquals(
    __TESTING__.selectStructuredEvidenceContent({
      payload: { approved: "content" },
      source_span: { page_number: 7 },
    }),
    { approved: "content" },
  );
});

Deno.test("legacy handler accepts same-tenant authenticated requests without ledger RPCs", async () => {
  assertExists(createGenerateProgramGoalsHandler);

  let invokeCompletionCalls = 0;
  let legacyLookupCalls = 0;
  const requestClientRpcCalls: string[] = [];
  const handler = createGenerateProgramGoalsHandler({
    createRequestClient: () => ({
      rpc: (name: string) => {
        requestClientRpcCalls.push(name);
        throw new Error("legacy path should not call request client RPCs");
      },
    }),
    getUserOrThrow: async () => ({ id: "77777777-7777-4777-8777-777777777777" }),
    requireOrg: async () => ORG_ID,
    lookupLegacyAssessment: async (_db: unknown, input: Record<string, string>) => {
      legacyLookupCalls += 1;
      assertEquals(input, {
        assessmentDocumentId: ASSESSMENT_ID,
        organizationId: ORG_ID,
        clientId: CLIENT_ID,
      });
      return { id: ASSESSMENT_ID };
    },
    invokeCompletion: async (payload: Record<string, unknown>, ledgerBound: boolean) => {
      invokeCompletionCalls += 1;
      assertEquals(ledgerBound, false);
      const prompt = (__TESTING__ as Record<string, unknown>).buildUserPrompt as (input: Record<string, unknown>) => string;
      const promptText = prompt(payload);
      assertEquals(promptText.includes("ASSESSMENT_DOCUMENT_ID: 11111111-1111-4111-8111-111111111111"), true);
      assertEquals(promptText.includes("CLIENT_DISPLAY_NAME: Client One"), true);
      assertEquals(promptText.includes("Use objective ABA language."), true);
      return buildValidResponse();
    },
  });

  const response = await handler(
    new Request("https://example.supabase.co/functions/v1/generate-program-goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify(buildLegacyRequest()),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(legacyLookupCalls, 1);
  assertEquals(invokeCompletionCalls, 1);
  assertEquals(requestClientRpcCalls, []);
});

Deno.test("legacy handler denies cross-tenant requests before completion invocation", async () => {
  assertExists(createGenerateProgramGoalsHandler);

  let invokeCompletionCalls = 0;
  const handler = createGenerateProgramGoalsHandler({
    createRequestClient: () => ({
      rpc: () => {
        throw new Error("legacy path should not call request client RPCs");
      },
    }),
    getUserOrThrow: async () => ({ id: "77777777-7777-4777-8777-777777777777" }),
    requireOrg: async () => ORG_ID,
    lookupLegacyAssessment: async () => null,
    invokeCompletion: async () => {
      invokeCompletionCalls += 1;
      return buildValidResponse();
    },
  });

  const response = await handler(
    new Request("https://example.supabase.co/functions/v1/generate-program-goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ ...buildLegacyRequest(), organization_id: OTHER_ORG_ID }),
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    error: "Legacy-bound draft generation denied",
    code: "generation_scope_denied",
  });
  assertEquals(invokeCompletionCalls, 0);
});

Deno.test("legacy handler preserves structured 502 output after exhausted non-timeout failures", async () => {
  assertExists(createGenerateProgramGoalsHandler);

  const handler = createGenerateProgramGoalsHandler({
    createRequestClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
    getUserOrThrow: async () => ({ id: "77777777-7777-4777-8777-777777777777" }),
    requireOrg: async () => ORG_ID,
    lookupLegacyAssessment: async () => ({ id: ASSESSMENT_ID }),
    invokeCompletion: async () => {
      const error = new Error(
        "Generated draft failed after 3 attempts. Last failure: schema_validation. " +
          "Failure categories: invalid_json,schema_validation.",
      );
      error.name = "GenerationAttemptsExhaustedError";
      throw error;
    },
  });

  const response = await handler(new Request("https://example.supabase.co/functions/v1/generate-program-goals", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(buildLegacyRequest()),
  }));

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error:
      "Generated draft failed after 3 attempts. Last failure: schema_validation. " +
      "Failure categories: invalid_json,schema_validation.",
  });
});

Deno.test("ledger organization mismatch preserves ledger-specific denial semantics", async () => {
  assertExists(createGenerateProgramGoalsHandler);

  const handler = createGenerateProgramGoalsHandler({
    createRequestClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
    getUserOrThrow: async () => ({ id: "77777777-7777-4777-8777-777777777777" }),
    requireOrg: async () => ORG_ID,
    lookupLegacyAssessment: async () => null,
    invokeCompletion: async () => buildValidResponse(),
  });

  const response = await handler(new Request("https://example.supabase.co/functions/v1/generate-program-goals", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify({
      assessmentDocumentId: ASSESSMENT_ID,
      clientId: CLIENT_ID,
      organizationId: OTHER_ORG_ID,
      workItemId: "44444444-4444-4444-8444-444444444444",
      correlationId: "caloptima-ledger.44444444-4444-4444-8444-444444444444",
    }),
  }));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    error: "Ledger-bound draft generation denied",
    code: "generation_scope_denied",
  });
});

Deno.test("ledger settlement preserves usage from an invalid completion before a provider exception", async () => {
  assertExists(createGenerateProgramGoalsHandler);

  const { supabaseAdmin } = await import("../_shared/database.ts");
  const { CALOPTIMA_LEDGER_MODEL_SNAPSHOT } = await import("./ledger.ts");
  const originalRpc = supabaseAdmin.rpc;
  let completionRpcArgs: Record<string, unknown> | null = null;

  supabaseAdmin.rpc = ((name: string, args: Record<string, unknown>) => {
    if (name === "begin_agent_work_caloptima_model_attempt") {
      return Promise.resolve({
        data: [{
          workflow_key: "assessment.caloptima.prepare_draft_review",
          workflow_version: 1,
          step_key: "suggest_draft_packet",
          provider: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.provider,
          model: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.model,
          prompt_version: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.promptVersion,
          tool_version: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.toolVersion,
          model_request_schema_version: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.modelRequestSchemaVersion,
          pricing_version: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.pricingVersion,
          temperature: CALOPTIMA_LEDGER_MODEL_SNAPSHOT.temperature,
          allowed_tools: [],
          guarded_tools: [],
          attempt_status: "running",
          step_id: "55555555-5555-4555-8555-555555555555",
          attempt_id: "66666666-6666-4666-8666-666666666666",
          output_hash: null,
        }],
        error: null,
      });
    }
    if (name === "complete_agent_work_caloptima_model_attempt") {
      completionRpcArgs = args;
      return Promise.resolve({ data: true, error: null });
    }
    throw new Error(`unexpected admin RPC: ${name}`);
  }) as unknown as typeof supabaseAdmin.rpc;

  const queryResults: Record<string, { data: unknown; error: null }> = {
    assessment_documents: {
      data: { id: ASSESSMENT_ID, organization_id: ORG_ID, client_id: CLIENT_ID, template_type: "caloptima_fba" },
      error: null,
    },
    assessment_checklist_items: {
      data: [{
        id: "88888888-8888-4888-8888-888888888888",
        section_key: "assessment_summary",
        label: "Synthetic summary",
        placeholder_key: "assessment_summary",
        value_text: "Synthetic approved assessment evidence with sufficient detail.",
        value_json: null,
        status: "approved",
        required: true,
      }],
      error: null,
    },
    assessment_structured_sections: {
      data: [{
        id: "99999999-9999-4999-8999-999999999999",
        section_key: "goals_treatment_planning",
        field_key: "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
        payload: { title: "Synthetic replacement goal" },
        source_span: { page: 1 },
        status: "approved",
        required: true,
      }],
      error: null,
    },
  };

  const createQuery = (table: string) => {
    const result = queryResults[table];
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  };

  const handler = createGenerateProgramGoalsHandler({
    createRequestClient: () => ({ from: (table: string) => createQuery(table) }),
    getUserOrThrow: async () => ({ id: "77777777-7777-4777-8777-777777777777" }),
    requireOrg: async () => ORG_ID,
    lookupLegacyAssessment: async () => null,
    requireLedgerAdvisoryRuntime: async () => {},
    invokeCompletion: async (
      _payload: Record<string, unknown>,
      _ledgerBound: boolean,
      onUsage: (inputTokens: number, outputTokens: number) => void,
    ) => {
      onUsage(17, 9);
      throw new Error("synthetic provider exception after invalid completion");
    },
  });

  try {
    const workItemId = "44444444-4444-4444-8444-444444444444";
    const requestId = `caloptima-ledger.${workItemId}`;
    const response = await handler(new Request("https://example.supabase.co/functions/v1/generate-program-goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        assessmentDocumentId: ASSESSMENT_ID,
        clientId: CLIENT_ID,
        organizationId: ORG_ID,
        workItemId,
        correlationId: requestId,
      }),
    }));

    assertEquals(response.status, 200);
    const settled = completionRpcArgs as Record<string, unknown> | null;
    assertExists(settled);
    assertEquals(settled.p_input_token_count, 17);
    assertEquals(settled.p_output_token_count, 9);
  } finally {
    supabaseAdmin.rpc = originalRpc;
  }
});
