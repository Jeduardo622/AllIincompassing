type AssertionError = Error & { name: "AssertionError" };

function fail(message: string): never {
  const error = new Error(message) as AssertionError;
  error.name = "AssertionError";
  throw error;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function attemptMutation(mutation: () => void): void {
  try {
    mutation();
  } catch (error) {
    assert(
      error instanceof TypeError,
      "expected frozen mutation to throw TypeError",
    );
  }
}

import {
  ASSESSMENT_PREP_BLOCKER_CODES,
  ASSESSMENT_PREP_PARITY_KINDS,
  ASSESSMENT_PREP_WORKFLOW,
  type AssessmentPrepAuthoritativeSnapshot,
  deriveAssessmentPrepShadow,
} from "./assessment-prep.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOCUMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHECKLIST_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SECTION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const REVIEW_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const LAYOUT_ID = "22222222-2222-4222-8222-222222222222";

function buildSnapshot(
  overrides: Partial<AssessmentPrepAuthoritativeSnapshot> = {},
): AssessmentPrepAuthoritativeSnapshot {
  return {
    organizationId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    assessmentDocumentId: DOCUMENT_ID,
    templateType: "iehp_fba",
    documentState: "extracted",
    scopeVerdict: "in_scope",
    reviewReadModel: {
      loaded: true,
      unresolvedRequiredCount: 0,
      missingRequiredEvidence: [],
      evidence: [
        {
          sourceKind: "assessment_document",
          sourceId: DOCUMENT_ID,
          sha256: "a".repeat(64),
        },
        {
          sourceKind: "assessment_review_event",
          sourceId: REVIEW_EVENT_ID,
          sha256: "b".repeat(64),
        },
        {
          sourceKind: "assessment_template_layout",
          sourceId: LAYOUT_ID,
          sha256: "c".repeat(64),
        },
      ],
    },
    ownerAuthorization: {
      ownerId: OWNER_ID,
      authorized: true,
      reasonCode: null,
    },
    ...overrides,
  };
}

function assertWorkflowImmutable(): void {
  const originalWorkflow = JSON.stringify(ASSESSMENT_PREP_WORKFLOW);

  attemptMutation(() => {
    (ASSESSMENT_PREP_WORKFLOW.steps as unknown as unknown[]).pop();
  });
  attemptMutation(() => {
    (
      ASSESSMENT_PREP_WORKFLOW.steps[1].dependencies as unknown as string[]
    ).push("request_clinical_review");
  });
  attemptMutation(() => {
    (
      ASSESSMENT_PREP_WORKFLOW.steps[0] as unknown as {
        completionPredicate: string;
      }
    ).completionPredicate = "always";
  });

  assertEquals(JSON.stringify(ASSESSMENT_PREP_WORKFLOW), originalWorkflow);
  assertEquals(ASSESSMENT_PREP_WORKFLOW.steps.length, 7);
  assertEquals(
    ASSESSMENT_PREP_WORKFLOW.workflow,
    "assessment.iehp.prepare_for_clinical_review@1",
  );
  assertEquals(
    ASSESSMENT_PREP_WORKFLOW.steps.map((step) => step.stepKey),
    [
      "validate_scope",
      "observe_upload",
      "await_extraction",
      "validate_review_evidence",
      "build_review_readiness",
      "assign_clinical_owner",
      "request_clinical_review",
    ],
  );
  assertEquals(
    ASSESSMENT_PREP_WORKFLOW.steps.map((step) => step.executionMode),
    [
      "deterministic",
      "deterministic",
      "deterministic",
      "deterministic",
      "deterministic",
      "human",
      "human",
    ],
  );
  assertEquals(
    ASSESSMENT_PREP_WORKFLOW.steps.map((step) => step.dependencies),
    [
      [],
      ["validate_scope"],
      ["observe_upload"],
      ["await_extraction"],
      ["validate_review_evidence"],
      ["build_review_readiness"],
      ["assign_clinical_owner"],
    ],
  );
  assertEquals(
    ASSESSMENT_PREP_BLOCKER_CODES.includes("missing_required_evidence"),
    true,
  );
  assertEquals(
    ASSESSMENT_PREP_PARITY_KINDS.includes(
      "missing_required_evidence_count_mismatch",
    ),
    true,
  );
}

Deno.test("only extracted is extraction-complete and all later or unknown states fail closed", () => {
  const cases = [
    "drafted",
    "approved",
    "rejected",
    "published",
    "archived",
  ] as const;

  for (const documentState of cases) {
    const result = deriveAssessmentPrepShadow(
      buildSnapshot({
        documentState:
          documentState as AssessmentPrepAuthoritativeSnapshot["documentState"],
      }),
    );

    assertEquals(result.projection.extractionState, "failed", documentState);
    assertEquals(result.workItemStatus, "blocked", documentState);
    assertEquals(
      result.projection.blockerCodes,
      ["document_state_out_of_contract"],
      documentState,
    );
    assertEquals(
      result.stepTransitions[2],
      {
        stepKey: "await_extraction",
        dependencies: ["observe_upload"],
        executionMode: "deterministic",
        risk: "clinical",
        targetStatus: "failed",
        reasonCode: "document_state_out_of_contract",
        completionSatisfied: false,
      },
      documentState,
    );
  }

  assertEquals(
    deriveAssessmentPrepShadow(buildSnapshot()).projection.extractionState,
    "complete",
  );
});

Deno.test("uploaded and extracting documents remain pending and stop at await_extraction", () => {
  for (
    const documentState of [
      "uploaded",
      "extracting",
      "extraction_running",
    ] as const
  ) {
    const result = deriveAssessmentPrepShadow(
      buildSnapshot({
        documentState,
        ownerAuthorization: {
          ownerId: null,
          authorized: false,
          reasonCode: "missing_owner",
        },
      }),
    );

    assertEquals(result.projection.extractionState, "pending", documentState);
    assertEquals(result.workItemStatus, "waiting", documentState);
    assertEquals(result.projection.blockerCodes, [], documentState);
    assertEquals(
      result.stepTransitions.map((step) => [step.stepKey, step.targetStatus]),
      [
        ["validate_scope", "completed"],
        ["observe_upload", "completed"],
        ["await_extraction", "waiting"],
        ["validate_review_evidence", "pending"],
        ["build_review_readiness", "pending"],
        ["assign_clinical_owner", "pending"],
        ["request_clinical_review", "pending"],
      ],
      documentState,
    );
  }
});

Deno.test("extraction failure blocks the workflow without inventing readiness", () => {
  const result = deriveAssessmentPrepShadow(
    buildSnapshot({ documentState: "extraction_failed" }),
  );

  assertEquals(result.projection.extractionState, "failed");
  assertEquals(result.workItemStatus, "blocked");
  assertEquals(result.projection.blockerCodes, ["extraction_failed"]);
  assertEquals(
    result.stepTransitions.map((
      step,
    ) => [step.stepKey, step.targetStatus, step.reasonCode]),
    [
      ["validate_scope", "completed", null],
      ["observe_upload", "completed", null],
      ["await_extraction", "failed", "extraction_failed"],
      ["validate_review_evidence", "pending", null],
      ["build_review_readiness", "pending", null],
      ["assign_clinical_owner", "pending", null],
      ["request_clinical_review", "pending", null],
    ],
  );
});

Deno.test("missing required evidence yields explicit blockers and parity descriptors when counts drift", () => {
  const result = deriveAssessmentPrepShadow(
    buildSnapshot({
      reviewReadModel: {
        loaded: true,
        unresolvedRequiredCount: 2,
        missingRequiredEvidence: [
          {
            sourceKind: "assessment_checklist_item",
            sourceId: CHECKLIST_ID,
            locator: "section:I/item:phone",
            sha256: "d".repeat(64),
          },
        ],
        evidence: [
          {
            sourceKind: "assessment_document",
            sourceId: DOCUMENT_ID,
            sha256: "a".repeat(64),
          },
          {
            sourceKind: "assessment_structured_section",
            sourceId: SECTION_ID,
            locator: "section:VIII",
            sha256: "e".repeat(64),
          },
        ],
      },
    }),
  );

  assertEquals(result.workItemStatus, "blocked");
  assertEquals(result.projection.blockerCodes, ["missing_required_evidence"]);
  assertEquals(result.missingRequiredEvidence.length, 1);
  assertEquals(result.generatedClinicalContent, false);
  assertEquals(
    result.stepTransitions.map((
      step,
    ) => [step.stepKey, step.targetStatus, step.reasonCode]),
    [
      ["validate_scope", "completed", null],
      ["observe_upload", "completed", null],
      ["await_extraction", "completed", null],
      ["validate_review_evidence", "completed", null],
      ["build_review_readiness", "completed", null],
      ["assign_clinical_owner", "completed", null],
      ["request_clinical_review", "failed", "missing_required_evidence"],
    ],
  );
  assertEquals(result.parity.descriptors.length, 1);
  assertEquals(
    result.parity.descriptors[0].kind,
    "missing_required_evidence_count_mismatch",
  );
  assertEquals(result.parity.events[0].metadata.expected_count, 2);
  assertEquals(result.parity.events[0].metadata.actual_count, 1);
});

Deno.test("review readiness requires document and loaded-read-model evidence pointers", () => {
  const evidenceCases = [
    {
      name: "no evidence",
      evidence: [],
    },
    {
      name: "missing document evidence",
      evidence: [
        {
          sourceKind: "assessment_template_layout" as const,
          sourceId: LAYOUT_ID,
          sha256: "c".repeat(64),
        },
      ],
    },
    {
      name: "document evidence targets another document",
      evidence: [
        {
          sourceKind: "assessment_document" as const,
          sourceId: SECTION_ID,
          sha256: "a".repeat(64),
        },
        {
          sourceKind: "assessment_template_layout" as const,
          sourceId: LAYOUT_ID,
          sha256: "c".repeat(64),
        },
      ],
    },
    {
      name: "missing read-model evidence",
      evidence: [
        {
          sourceKind: "assessment_document" as const,
          sourceId: DOCUMENT_ID,
          sha256: "a".repeat(64),
        },
      ],
    },
  ];

  for (const testCase of evidenceCases) {
    const result = deriveAssessmentPrepShadow(
      buildSnapshot({
        reviewReadModel: {
          loaded: true,
          unresolvedRequiredCount: 0,
          missingRequiredEvidence: [],
          evidence: testCase.evidence,
        },
      }),
    );

    assertEquals(result.workItemStatus, "blocked", testCase.name);
    assertEquals(
      result.projection.blockerCodes,
      ["missing_required_evidence"],
      testCase.name,
    );
    assertEquals(result.generatedClinicalContent, false, testCase.name);
  }
});

Deno.test("review-ready snapshots are deterministic and stop at needs_review", () => {
  const result = deriveAssessmentPrepShadow(buildSnapshot());

  assertEquals(result.projection.templateType, "iehp_fba");
  assertEquals(result.projection.extractionState, "complete");
  assertEquals(result.projection.blockerCodes, []);
  assertEquals(result.workItemStatus, "needs_review");
  assertEquals(result.parity.descriptors, []);
  assertEquals(result.generatedClinicalContent, false);
  assertEquals(
    result.stepTransitions.every((step) => step.targetStatus === "completed"),
    true,
  );

  const reordered = deriveAssessmentPrepShadow(
    buildSnapshot({
      reviewReadModel: {
        ...buildSnapshot().reviewReadModel,
        evidence: [...buildSnapshot().reviewReadModel.evidence].reverse(),
      },
    }),
  );

  assertEquals(
    result.projection.readinessHash,
    reordered.projection.readinessHash,
  );
});

Deno.test("wrong template, wrong client, wrong organization, and missing documents fail closed", () => {
  const cases = [
    {
      name: "wrong template",
      snapshot: buildSnapshot({ templateType: "caloptima_fba" }),
      blockerCodes: ["template_type_mismatch"],
      blockedStep: "validate_scope",
    },
    {
      name: "wrong client",
      snapshot: buildSnapshot({ scopeVerdict: "wrong_client" }),
      blockerCodes: ["scope_wrong_client"],
      blockedStep: "validate_scope",
    },
    {
      name: "wrong organization",
      snapshot: buildSnapshot({ scopeVerdict: "wrong_organization" }),
      blockerCodes: ["scope_wrong_organization"],
      blockedStep: "validate_scope",
    },
    {
      name: "deleted or invalid document",
      snapshot: buildSnapshot({
        scopeVerdict: "missing_or_invalid",
        documentState: "missing",
      }),
      blockerCodes: ["document_missing_or_invalid"],
      blockedStep: "validate_scope",
    },
  ] as const;

  for (const testCase of cases) {
    const result = deriveAssessmentPrepShadow(testCase.snapshot);
    assertEquals(result.workItemStatus, "blocked", testCase.name);
    assertEquals(
      result.projection.blockerCodes,
      [...testCase.blockerCodes],
      testCase.name,
    );
    const blockedStep = result.stepTransitions.find((step) =>
      step.targetStatus === "failed"
    );
    assert(blockedStep, `${testCase.name}: expected a blocked step`);
    assertEquals(blockedStep.stepKey, testCase.blockedStep, testCase.name);
  }
});

Deno.test("owner authorization accepts only a valid owner, true verdict, and null reason", () => {
  const cases = [
    {
      name: "missing owner",
      ownerAuthorization: {
        ownerId: null,
        authorized: false,
        reasonCode: "missing_owner",
      },
      blockerCodes: ["missing_owner"],
    },
    {
      name: "unauthorized owner",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: false,
        reasonCode: "owner_not_authorized",
      },
      blockerCodes: ["owner_not_authorized"],
    },
    {
      name: "authorization unavailable",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: false,
        reasonCode: "authorization_unavailable",
      },
      blockerCodes: ["authorization_unavailable"],
    },
    {
      name: "authorized without owner",
      ownerAuthorization: {
        ownerId: null,
        authorized: true,
        reasonCode: null,
      },
      blockerCodes: ["missing_owner"],
    },
    {
      name: "unauthorized without reason",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: false,
        reasonCode: null,
      },
      blockerCodes: ["owner_not_authorized"],
    },
    {
      name: "malformed owner identifier",
      ownerAuthorization: {
        ownerId: "not-an-owner-id",
        authorized: true,
        reasonCode: null,
      },
      blockerCodes: ["missing_owner"],
    },
    {
      name: "authorized with stale missing-owner reason",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: true,
        reasonCode: "missing_owner",
      },
      blockerCodes: ["missing_owner"],
    },
    {
      name: "authorized with stale unauthorized reason",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: true,
        reasonCode: "owner_not_authorized",
      },
      blockerCodes: ["owner_not_authorized"],
    },
    {
      name: "authorized with stale unavailable reason",
      ownerAuthorization: {
        ownerId: OWNER_ID,
        authorized: true,
        reasonCode: "authorization_unavailable",
      },
      blockerCodes: ["authorization_unavailable"],
    },
  ] as const;

  for (const testCase of cases) {
    const result = deriveAssessmentPrepShadow(
      buildSnapshot({ ownerAuthorization: testCase.ownerAuthorization }),
    );
    assertEquals(result.workItemStatus, "blocked", testCase.name);
    assertEquals(
      result.projection.blockerCodes,
      [...testCase.blockerCodes],
      testCase.name,
    );
    assertEquals(
      result.stepTransitions.map((
        step,
      ) => [step.stepKey, step.targetStatus, step.reasonCode]),
      [
        ["validate_scope", "completed", null],
        ["observe_upload", "completed", null],
        ["await_extraction", "completed", null],
        ["validate_review_evidence", "completed", null],
        ["build_review_readiness", "completed", null],
        ["assign_clinical_owner", "failed", testCase.blockerCodes[0]],
        ["request_clinical_review", "pending", null],
      ],
      testCase.name,
    );
  }

  const ownerIds = [
    null,
    "not-an-owner-id",
    "00000000-0000-0000-0000-000000000000",
    OWNER_ID,
  ];
  const reasons:
    AssessmentPrepAuthoritativeSnapshot["ownerAuthorization"]["reasonCode"][] =
      [
        null,
        "missing_owner",
        "owner_not_authorized",
        "authorization_unavailable",
      ];

  for (const ownerId of ownerIds) {
    for (const authorized of [false, true]) {
      for (const reasonCode of reasons) {
        const label = JSON.stringify({ ownerId, authorized, reasonCode });
        const result = deriveAssessmentPrepShadow(
          buildSnapshot({
            ownerAuthorization: { ownerId, authorized, reasonCode },
          }),
        );
        const isValidVerdict = ownerId === OWNER_ID && authorized &&
          reasonCode === null;

        if (isValidVerdict) {
          assertEquals(result.workItemStatus, "needs_review", label);
          assertEquals(result.projection.blockerCodes, [], label);
          continue;
        }

        assertEquals(result.workItemStatus, "blocked", label);
        assertEquals(result.projection.blockerCodes.length, 1, label);
        assert(
          [
            "missing_owner",
            "owner_not_authorized",
            "authorization_unavailable",
          ].includes(result.projection.blockerCodes[0]),
          `${label}: expected a closed owner blocker`,
        );
        assertEquals(
          result.stepTransitions[5].targetStatus,
          "failed",
          label,
        );
      }
    }
  }

  assertEquals(
    deriveAssessmentPrepShadow(buildSnapshot()).workItemStatus,
    "needs_review",
  );
});

Deno.test("missing required evidence accepts only checklist or structured-section pointers", () => {
  const allowed: AssessmentPrepAuthoritativeSnapshot["reviewReadModel"][
    "missingRequiredEvidence"
  ] = [
    {
      sourceKind: "assessment_checklist_item",
      sourceId: CHECKLIST_ID,
      sha256: "d".repeat(64),
    },
    {
      sourceKind: "assessment_structured_section",
      sourceId: SECTION_ID,
      sha256: "e".repeat(64),
    },
  ];

  assertEquals(allowed.length, 2);

  const invalid: AssessmentPrepAuthoritativeSnapshot["reviewReadModel"][
    "missingRequiredEvidence"
  ] = [
    {
      // @ts-expect-error document pointers cannot represent missing required items
      sourceKind: "assessment_document",
      sourceId: DOCUMENT_ID,
      sha256: "a".repeat(64),
    },
  ];
  assertEquals(invalid.length, 1);
});

Deno.test("runtime-invalid missing required evidence is blocked and never echoed", () => {
  const invalidCases: Array<{ name: string; pointer: unknown }> = [
    {
      name: "assessment document kind",
      pointer: {
        sourceKind: "assessment_document",
        sourceId: CHECKLIST_ID,
        sha256: "f".repeat(64),
      },
    },
    {
      name: "review event kind",
      pointer: {
        sourceKind: "assessment_review_event",
        sourceId: CHECKLIST_ID,
        sha256: "f".repeat(64),
      },
    },
    {
      name: "template layout kind",
      pointer: {
        sourceKind: "assessment_template_layout",
        sourceId: CHECKLIST_ID,
        sha256: "f".repeat(64),
      },
    },
    {
      name: "unknown kind",
      pointer: {
        sourceKind: "assessment_unknown",
        sourceId: CHECKLIST_ID,
        sha256: "f".repeat(64),
      },
    },
    {
      name: "malformed source id",
      pointer: {
        sourceKind: "assessment_checklist_item",
        sourceId: "not-a-uuid",
        sha256: "f".repeat(64),
      },
    },
    {
      name: "zero source id",
      pointer: {
        sourceKind: "assessment_structured_section",
        sourceId: "00000000-0000-0000-0000-000000000000",
        sha256: "f".repeat(64),
      },
    },
    {
      name: "short hash",
      pointer: {
        sourceKind: "assessment_checklist_item",
        sourceId: CHECKLIST_ID,
        sha256: "abc123",
      },
    },
    {
      name: "non-hex hash",
      pointer: {
        sourceKind: "assessment_structured_section",
        sourceId: SECTION_ID,
        sha256: "z".repeat(64),
      },
    },
    {
      name: "non-object pointer",
      pointer: null,
    },
  ];
  let sanitizedReadinessHash: string | null = null;

  for (const testCase of invalidCases) {
    const result = deriveAssessmentPrepShadow(
      buildSnapshot({
        reviewReadModel: {
          ...buildSnapshot().reviewReadModel,
          missingRequiredEvidence: [testCase.pointer] as any,
        },
      }),
    );

    assertEquals(result.workItemStatus, "blocked", testCase.name);
    assertEquals(
      result.projection.blockerCodes,
      ["invalid_required_evidence"],
      testCase.name,
    );
    assertEquals(result.missingRequiredEvidence, [], testCase.name);
    assertEquals(result.projection.evidence.length, 3, testCase.name);
    assertEquals(
      result.stepTransitions[3].reasonCode,
      "invalid_required_evidence",
      testCase.name,
    );

    if (sanitizedReadinessHash === null) {
      sanitizedReadinessHash = result.projection.readinessHash;
    } else {
      assertEquals(
        result.projection.readinessHash,
        sanitizedReadinessHash,
        `${testCase.name}: invalid pointer data must not affect hashing`,
      );
    }
  }
});

Deno.test("runtime-valid missing evidence returns only checklist and structured-section pointers", () => {
  const missingRequiredEvidence = [
    {
      sourceKind: "assessment_checklist_item",
      sourceId: CHECKLIST_ID,
      sha256: "d".repeat(64),
    },
    {
      sourceKind: "assessment_structured_section",
      sourceId: SECTION_ID,
      sha256: "e".repeat(64),
    },
  ] as const;
  const result = deriveAssessmentPrepShadow(
    buildSnapshot({
      reviewReadModel: {
        ...buildSnapshot().reviewReadModel,
        unresolvedRequiredCount: 2,
        missingRequiredEvidence: [...missingRequiredEvidence],
      },
    }),
  );

  assertEquals(result.workItemStatus, "blocked");
  assertEquals(result.projection.blockerCodes, ["missing_required_evidence"]);
  assertEquals(result.missingRequiredEvidence, [...missingRequiredEvidence]);
  assertEquals(
    result.missingRequiredEvidence.map((pointer) => pointer.sourceKind),
    ["assessment_checklist_item", "assessment_structured_section"],
  );

  const mixedResult = deriveAssessmentPrepShadow(
    buildSnapshot({
      reviewReadModel: {
        ...buildSnapshot().reviewReadModel,
        unresolvedRequiredCount: 2,
        missingRequiredEvidence: [
          ...missingRequiredEvidence,
          {
            sourceKind: "assessment_review_event",
            sourceId: REVIEW_EVENT_ID,
            sha256: "f".repeat(64),
          },
        ] as any,
      },
    }),
  );

  assertEquals(mixedResult.workItemStatus, "blocked");
  assertEquals(mixedResult.projection.blockerCodes, [
    "invalid_required_evidence",
    "missing_required_evidence",
  ]);
  assertEquals(
    mixedResult.missingRequiredEvidence,
    [...missingRequiredEvidence],
  );
  assertEquals(mixedResult.projection.evidence.length, 5);
});

Deno.test(
  "workflow template is immutable and uses the seven documented step keys",
  assertWorkflowImmutable,
);
