type AssertionError = Error & { name: "AssertionError" };

function fail(message: string): never {
  const error = new Error(message) as AssertionError;
  error.name = "AssertionError";
  throw error;
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertThrows(
  fn: () => unknown,
  expectedCode: string,
  name: string,
): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) {
      fail(`${name}: expected Error instance`);
    }
    assertEquals(
      (error as Error & { code?: string }).code,
      expectedCode,
      `${name}: code`,
    );
    return;
  }

  fail(`${name}: expected throw`);
}

import {
  type SanitizedEventMetadata,
  sanitizeTransitionEventMetadata,
  validateStoredEventMetadata,
} from "./events.ts";

const ATTEMPT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WORKER_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("sanitizeTransitionEventMetadata matches the Task 2 RPC metadata contract exactly", () => {
  const sanitized = sanitizeTransitionEventMetadata({
    worker_id: WORKER_ID,
    attempt_id: ATTEMPT_ID,
    result_code: "projection_recorded",
    evidence_hash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    duration_ms: 1200,
    retry_count: 2,
  });

  const expected: SanitizedEventMetadata = {
    worker_id: WORKER_ID,
    attempt_id: ATTEMPT_ID,
    result_code: "projection_recorded",
    evidence_hash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    duration_ms: 1200,
    retry_count: 2,
  };

  assertEquals(sanitized, expected);
});

Deno.test("sanitizeTransitionEventMetadata rejects caller tool selection and stored-only keys", () => {
  for (
    const [name, value] of Object.entries({
      tool: { tool: "review_snapshot" },
      workflow: { workflow_key: "assessment.iehp.prepare_for_clinical_review" },
      approval: { approval_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      status: { to_status: "completed" },
    })
  ) {
    assertThrows(
      () => sanitizeTransitionEventMetadata(value),
      "event_metadata_key_forbidden",
      name,
    );
  }
});

Deno.test("validateStoredEventMetadata accepts Task 2 system-emitted metadata shapes", () => {
  const rows: ReadonlyArray<Record<string, unknown>> = [
    {
      workflow_key: "assessment.iehp.prepare_for_clinical_review",
      workflow_version: 1,
      assessment_document_id: "99999999-9999-4999-8999-999999999999",
    },
    {
      lease_seconds: 60,
      attempt_number: 1,
    },
    {
      worker_id: WORKER_ID,
      attempt_id: ATTEMPT_ID,
      result_code: "projection_recorded",
      evidence_hash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      duration_ms: 1200,
      retry_count: 2,
      approval_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      to_status: "completed",
      reason_code: "step_completed",
    },
    {
      approval_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      request_reason_code: "clinical_review_handoff",
      clinical_review_handoff: true,
    },
    {
      approval_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      reason_code: "clinical_review_accepted",
      decision: "approve",
    },
    {
      msg_id: 42,
      retry_scheduled: true,
      workflow_version: 1,
      correlation_id: "ledger.item-1",
      delay_seconds: 30,
      poison: false,
    },
  ];

  for (const row of rows) {
    assertEquals(validateStoredEventMetadata(row), row);
  }
});

Deno.test("event metadata validators reject sensitive keys, narratives, URLs, and invalid values", () => {
  const sensitiveKeys = [
    "document_text",
    "patient_name",
    "address",
    "contact_email",
    "diagnosis",
    "clinical_notes",
    "prompt",
    "reasoning_trace",
    "authorization",
    "secret_key",
    "signed_url",
    "assigned_to",
  ];

  for (const key of sensitiveKeys) {
    assertThrows(
      () => validateStoredEventMetadata({ [key]: "jane" }),
      "event_metadata_key_forbidden",
      key,
    );
  }

  const invalidCases: Array<[string, Record<string, unknown>, string]> = [
    [
      "nested object",
      { reason_code: { code: "step_completed" } },
      "event_metadata_type_forbidden",
    ],
    [
      "short narrative",
      { reason_code: "jane needs help" },
      "event_metadata_value_forbidden",
    ],
    [
      "signed URL",
      { result_code: "https://signed.example/run" },
      "event_metadata_value_forbidden",
    ],
    ["bad hash", { evidence_hash: "ABC123" }, "event_metadata_value_forbidden"],
    [
      "negative duration",
      { duration_ms: -1 },
      "event_metadata_value_forbidden",
    ],
    ["bad lease", { lease_seconds: 901 }, "event_metadata_value_forbidden"],
    ["bad attempt", { attempt_number: 0 }, "event_metadata_value_forbidden"],
  ];

  for (const [name, value, code] of invalidCases) {
    assertThrows(() => validateStoredEventMetadata(value), code, name);
  }
});
