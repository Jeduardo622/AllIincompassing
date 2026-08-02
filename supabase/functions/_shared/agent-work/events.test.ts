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
  if (!Object.is(actual, expected)) {
    fail(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, expectedCode: string, name: string): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error, `${name}: expected Error instance`);
    assertEquals((error as Error & { code?: string }).code, expectedCode, `${name}: code`);
    return;
  }

  fail(`${name}: expected throw`);
}

import {
  sanitizeEventMetadata,
  type SanitizedEventMetadata,
} from "./events.ts";

Deno.test("sanitizeEventMetadata accepts only explicit PHI-free keys and bounded values", () => {
  const sanitized = sanitizeEventMetadata({
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    work_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    step_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    attempt_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    actor_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    approval_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidence_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    workflow: "assessment.iehp.prepare_for_clinical_review@1",
    action: "transition_step",
    tool: "review_snapshot",
    runtime_mode: "active",
    status: "needs_review",
    outcome: "approved",
    reason_code: "approval_current",
    result_code: "projection_recorded",
    retry_count: 2,
    duration_ms: 1200,
    token_count: 4096,
    prompt_token_count: 1024,
    completion_token_count: 3072,
    item_count: 3,
  });

  const expected: SanitizedEventMetadata = {
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    work_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    step_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    attempt_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    actor_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    approval_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidence_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    workflow: "assessment.iehp.prepare_for_clinical_review@1",
    action: "transition_step",
    tool: "review_snapshot",
    runtime_mode: "active",
    status: "needs_review",
    outcome: "approved",
    reason_code: "approval_current",
    result_code: "projection_recorded",
    retry_count: 2,
    duration_ms: 1200,
    token_count: 4096,
    prompt_token_count: 1024,
    completion_token_count: 3072,
    item_count: 3,
  };

  assertEquals(JSON.stringify(sanitized), JSON.stringify(expected), "sanitized metadata round-trips allowlisted values");
});

Deno.test("sanitizeEventMetadata rejects sensitive keys and PHI-like free text", () => {
  const cases: Array<{ name: string; value: Record<string, unknown> }> = [
    {
      name: "raw document text",
      value: { document_text: "Client presented with aggression during school pickup." },
    },
    {
      name: "patient name",
      value: { patient_name: "Jane Doe" },
    },
    {
      name: "address",
      value: { address: "123 Main Street" },
    },
    {
      name: "contact detail",
      value: { contact_email: "jane@example.com" },
    },
    {
      name: "clinical notes",
      value: { clinical_notes: "Observed dysregulation and elopement." },
    },
    {
      name: "prompt",
      value: { prompt: "Summarize the diagnosis and caregiver concerns." },
    },
    {
      name: "reasoning",
      value: { reasoning_trace: "The model inferred missing parent signatures." },
    },
    {
      name: "authorization header",
      value: { authorization: "Bearer secret-token" },
    },
    {
      name: "secret",
      value: { secret_key: "super-secret" },
    },
    {
      name: "signed url",
      value: { signed_url: "https://example.com/file?sig=abc123" },
    },
  ];

  for (const testCase of cases) {
    assertThrows(
      () => sanitizeEventMetadata(testCase.value),
      "event_metadata_key_forbidden",
      testCase.name,
    );
  }
});

Deno.test("sanitizeEventMetadata rejects disallowed value shapes and sensitive string patterns", () => {
  const cases: Array<{ name: string; value: Record<string, unknown>; code: string }> = [
    {
      name: "nested object",
      value: { reason_code: { code: "approval_current" } },
      code: "event_metadata_type_forbidden",
    },
    {
      name: "narrative in allowed key",
      value: { reason_code: "patient discussed transportation barriers" },
      code: "event_metadata_value_forbidden",
    },
    {
      name: "bad hash",
      value: { evidence_hash: "ABC123" },
      code: "event_metadata_value_forbidden",
    },
    {
      name: "negative duration",
      value: { duration_ms: -1 },
      code: "event_metadata_value_forbidden",
    },
    {
      name: "signed url in allowed token key",
      value: { tool: "https://signed.example.com/run?signature=abc" },
      code: "event_metadata_value_forbidden",
    },
  ];

  for (const testCase of cases) {
    assertThrows(
      () => sanitizeEventMetadata(testCase.value),
      testCase.code,
      testCase.name,
    );
  }
});
