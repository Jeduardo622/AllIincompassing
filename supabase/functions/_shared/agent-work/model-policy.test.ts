import {
  validateAssessmentRemediationSuggestion,
  validateModelAttemptScope,
  validateModelToolInvocation,
} from "./policy.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const WORK_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const STEP_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const EVIDENCE_ID = "66666666-6666-4666-8666-666666666666";

const correlation = {
  organizationId: ORGANIZATION_ID,
  clientId: CLIENT_ID,
  workItemId: WORK_ITEM_ID,
  stepId: STEP_ID,
  attemptId: ATTEMPT_ID,
  workflowVersion: 1,
  correlationId: "corr-task11-001",
};

const authority = {
  ...correlation,
  workflowKey: "assessment.iehp.prepare_for_clinical_review",
  stepKey: "validate_review_evidence",
  attemptStatus: "running" as const,
  promptVersion: "iehp-remediation-v1",
  toolVersion: "iehp-remediation-tools-v1",
  allowedTools: [] as string[],
  guardedTools: [] as string[],
  blockerCodes: ["missing_required_evidence"],
  suggestedActionCodes: ["request_missing_evidence"],
  evidenceSourceIds: [EVIDENCE_ID],
};

Deno.test("model attempt scope accepts only an exact authoritative binding", () => {
  assertEquals(validateModelAttemptScope(correlation, authority), {
    allowed: true,
    reasonCode: "allowed",
  });

  assertEquals(validateModelAttemptScope(correlation, null), {
    allowed: false,
    reasonCode: "unknown_attempt",
  });

  assertEquals(
    validateModelAttemptScope(correlation, {
      ...authority,
      clientId: "77777777-7777-4777-8777-777777777777",
    }),
    { allowed: false, reasonCode: "scope_mismatch" },
  );

  assertEquals(
    validateModelAttemptScope(correlation, {
      ...authority,
      promptVersion: null,
    }),
    { allowed: false, reasonCode: "attempt_snapshot_incomplete" },
  );

  assertEquals(
    validateModelAttemptScope(correlation, {
      ...authority,
      evidenceSourceIds: [],
    }),
    { allowed: false, reasonCode: "attempt_policy_invalid" },
  );
});

Deno.test("model tool policy rejects forbidden and unguarded custom tools", () => {
  assertEquals(
    validateModelToolInvocation("lookup_review_evidence", {
      allowedTools: [],
      guardedTools: [],
    }),
    { allowed: false, reasonCode: "forbidden_tool" },
  );

  assertEquals(
    validateModelToolInvocation("lookup_review_evidence", {
      allowedTools: ["lookup_review_evidence"],
      guardedTools: [],
    }),
    { allowed: false, reasonCode: "unguarded_tool" },
  );

  assertEquals(
    validateModelToolInvocation("lookup_review_evidence", {
      allowedTools: ["lookup_review_evidence"],
      guardedTools: ["lookup_review_evidence"],
    }),
    { allowed: true, reasonCode: "allowed" },
  );
});

Deno.test("remediation output remains code-only advisory evidence", () => {
  const allowed = validateAssessmentRemediationSuggestion(
    {
      blockerCode: "missing_required_evidence",
      suggestedActionCode: "request_missing_evidence",
      evidenceSourceIds: [EVIDENCE_ID],
      confidence: 0.75,
      requiresHumanReview: true,
    },
    authority,
  );
  assertEquals(allowed, {
    allowed: true,
    reasonCode: "allowed",
    suggestion: {
      blockerCode: "missing_required_evidence",
      suggestedActionCode: "request_missing_evidence",
      evidenceSourceIds: [EVIDENCE_ID],
      confidence: 0.75,
      requiresHumanReview: true,
    },
  });

  const completionClaim = validateAssessmentRemediationSuggestion(
    {
      blockerCode: "missing_required_evidence",
      suggestedActionCode: "request_missing_evidence",
      evidenceSourceIds: [EVIDENCE_ID],
      confidence: 0.75,
      requiresHumanReview: true,
      completed: true,
    },
    authority,
  );
  assertEquals(completionClaim, {
    allowed: false,
    reasonCode: "model_output_key_forbidden",
  });

  assertEquals(
    validateAssessmentRemediationSuggestion(
      {
        blockerCode: "missing_required_evidence",
        suggestedActionCode: "request_missing_evidence",
        evidenceSourceIds: [],
        confidence: 0.75,
        requiresHumanReview: true,
      },
      authority,
    ),
    { allowed: false, reasonCode: "model_output_invalid" },
  );
});
