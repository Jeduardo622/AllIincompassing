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

Deno.test("workflow template is immutable and uses the seven documented step keys", () => {
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

Deno.test("owner authorization is fail-closed and does not derive roles inside the adapter", () => {
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
});
