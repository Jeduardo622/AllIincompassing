import { deepStrictEqual as assertEquals, rejects as assertRejects } from "node:assert/strict";
import {
  CALOPTIMA_LEDGER_MODEL_SNAPSHOT,
  LedgerPreparationError,
  hashLedgerModelOutput,
  ledgerGenerationSchema,
  prepareLedgerGeneration,
} from "./ledger.ts";

const correlation = ledgerGenerationSchema.parse({
  assessmentDocumentId: "11111111-1111-4111-8111-111111111111",
  organizationId: "33333333-3333-4333-8333-333333333333",
  clientId: "22222222-2222-4222-8222-222222222222",
  workItemId: "44444444-4444-4444-8444-444444444444",
  correlationId: "caloptima.test.1",
});

Deno.test("ledger request excludes caller evidence and authority fields", () => {
  assertEquals(ledgerGenerationSchema.safeParse(correlation).success, true);
  assertEquals(ledgerGenerationSchema.safeParse({
    ...correlation,
    approved_checklist_rows: [{ value_text: "caller evidence" }],
  }).success, false);
  assertEquals(ledgerGenerationSchema.safeParse({ ...correlation, completion: "approved" }).success, false);
  assertEquals(ledgerGenerationSchema.safeParse({ ...correlation, tools: ["assessment-promote"] }).success, false);
});

Deno.test("ledger preparation claims the fixed no-tool attempt before loading fresh model input", async () => {
  const calls: string[] = [];
  const payload = {
    assessment_document_id: correlation.assessmentDocumentId,
    organization_id: correlation.organizationId,
    client_id: correlation.clientId,
    assessment_summary: "Synthetic approved evidence only.",
  };
  const result = await prepareLedgerGeneration({
    actorUserId: "77777777-7777-4777-8777-777777777777",
    requestId: "request.caloptima.1",
    correlation,
  }, {
    loadAuthoritativePayload: async () => {
      calls.push("load");
      return payload;
    },
    beginAttempt: async (input) => {
      calls.push("begin");
      assertEquals(input.provider, CALOPTIMA_LEDGER_MODEL_SNAPSHOT.provider);
      assertEquals(input.promptVersion, "caloptima-draft-review.prompt.v1");
      assertEquals(input.toolVersion, "caloptima-draft-review.no-tools.v1");
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
  assertEquals(result, {
    payload,
    authoritative: true,
    stepId: "55555555-5555-4555-8555-555555555555",
    attemptId: "66666666-6666-4666-8666-666666666666",
    replay: false,
    replayOutputHash: null,
    canTransitionWorkflow: false,
    canPublish: false,
  });
});

Deno.test("ledger preparation fails closed on scope mismatch and snapshot denial", async () => {
  const base = {
    actorUserId: "77777777-7777-4777-8777-777777777777",
    requestId: "request.caloptima.2",
    correlation,
  };
  const settlements: unknown[] = [];
  await assertRejects(
    () => prepareLedgerGeneration(base, {
      loadAuthoritativePayload: async () => ({
        assessment_document_id: correlation.assessmentDocumentId,
        organization_id: correlation.organizationId,
        client_id: "88888888-8888-4888-8888-888888888888",
      }),
      beginAttempt: async () => ({
        authoritative: true,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      }),
      settleAttemptFailure: async (input) => {
        settlements.push(input);
      },
    }),
    LedgerPreparationError,
    "authoritative_scope_mismatch",
  );
  await assertRejects(
    () => prepareLedgerGeneration(base, {
      loadAuthoritativePayload: async () => ({
        assessment_document_id: correlation.assessmentDocumentId,
        organization_id: correlation.organizationId,
        client_id: correlation.clientId,
      }),
      beginAttempt: async () => ({
        authoritative: false,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      }),
      settleAttemptFailure: async (input) => {
        settlements.push(input);
      },
    }),
    LedgerPreparationError,
    "attempt_snapshot_denied",
  );
  assertEquals(settlements, [
    {
      actorUserId: base.actorUserId,
      correlation,
      stepId: "55555555-5555-4555-8555-555555555555",
      attemptId: "66666666-6666-4666-8666-666666666666",
      errorCode: "authoritative_scope_mismatch",
    },
    {
      actorUserId: base.actorUserId,
      correlation,
      stepId: "55555555-5555-4555-8555-555555555555",
      attemptId: "66666666-6666-4666-8666-666666666666",
      errorCode: "attempt_snapshot_denied",
    },
  ]);
});

Deno.test("ledger preparation settles authoritative payload load failures before returning a structured error", async () => {
  const settlements: unknown[] = [];
  await assertRejects(
    () => prepareLedgerGeneration({
      actorUserId: "77777777-7777-4777-8777-777777777777",
      requestId: "request.caloptima.load-failure",
      correlation,
    }, {
      loadAuthoritativePayload: async () => {
        throw new Error("synthetic database detail must not escape");
      },
      beginAttempt: async () => ({
        authoritative: true,
        stepId: "55555555-5555-4555-8555-555555555555",
        attemptId: "66666666-6666-4666-8666-666666666666",
        attemptStatus: "running",
        outputHash: null,
      }),
      settleAttemptFailure: async (input) => {
        settlements.push(input);
      },
    }),
    LedgerPreparationError,
    "authoritative_payload_unavailable",
  );
  assertEquals(settlements, [{
    actorUserId: "77777777-7777-4777-8777-777777777777",
    correlation,
    stepId: "55555555-5555-4555-8555-555555555555",
    attemptId: "66666666-6666-4666-8666-666666666666",
    errorCode: "authoritative_payload_unavailable",
  }]);
});

Deno.test("completed ledger attempts replay persisted drafts without loading mutable clinical state", async () => {
  let authoritativeLoadCount = 0;
  const result = await prepareLedgerGeneration({
    actorUserId: "77777777-7777-4777-8777-777777777777",
    requestId: "request.caloptima.replay",
    correlation,
  }, {
    loadAuthoritativePayload: async () => {
      authoritativeLoadCount += 1;
      throw new Error("mutable_authority_unavailable");
    },
    beginAttempt: async () => ({
      authoritative: true,
      stepId: "55555555-5555-4555-8555-555555555555",
      attemptId: "66666666-6666-4666-8666-666666666666",
      attemptStatus: "completed",
      outputHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    settleAttemptFailure: async () => {
      throw new Error("unexpected_settlement");
    },
  });

  assertEquals(result.replay, true);
  assertEquals(result.payload, null);
  assertEquals(authoritativeLoadCount, 0);
  assertEquals(
    result.replayOutputHash,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assertEquals(result.canTransitionWorkflow, false);
  assertEquals(result.canPublish, false);
});

Deno.test("ledger model output hashing is canonical and payload-bound", async () => {
  const left = await hashLedgerModelOutput({ programs: [{ name: "Synthetic" }], confidence: "high" });
  const reordered = await hashLedgerModelOutput({ confidence: "high", programs: [{ name: "Synthetic" }] });
  const changed = await hashLedgerModelOutput({ confidence: "low", programs: [{ name: "Synthetic" }] });
  assertEquals(left, reordered);
  assertEquals(/^[0-9a-f]{64}$/.test(left), true);
  assertEquals(left === changed, false);
});
