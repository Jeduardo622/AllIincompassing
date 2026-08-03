export const CALOPTIMA_LEDGER_WORKFLOW = "assessment.caloptima.prepare_draft_review";
export const CALOPTIMA_LEDGER_MODEL_SNAPSHOT = Object.freeze({
  provider: "openai",
  model: "gpt-4o",
  promptVersion: "caloptima-draft-review.prompt.v1",
  toolVersion: "caloptima-draft-review.no-tools.v1",
  modelRequestSchemaVersion: "caloptima-draft-review.response.v1",
  pricingVersion: "gpt-4o-estimate.v1",
  temperature: 0.1,
  allowedTools: [] as string[],
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CORRELATION_KEYS = new Set([
  "assessmentDocumentId",
  "organizationId",
  "clientId",
  "workItemId",
  "correlationId",
]);

export type LedgerGenerationCorrelation = {
  assessmentDocumentId: string;
  organizationId: string;
  clientId: string;
  workItemId: string;
  correlationId: string;
};

function parseLedgerGeneration(value: unknown): LedgerGenerationCorrelation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_ledger_generation_correlation");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !CORRELATION_KEYS.has(key)) || Object.keys(input).length !== CORRELATION_KEYS.size) {
    throw new Error("invalid_ledger_generation_correlation");
  }
  const uuidKeys = [
    "assessmentDocumentId",
    "organizationId",
    "clientId",
    "workItemId",
  ] as const;
  if (uuidKeys.some((key) => typeof input[key] !== "string" || !UUID_PATTERN.test(input[key] as string))) {
    throw new Error("invalid_ledger_generation_correlation");
  }
  if (typeof input.correlationId !== "string" || !CORRELATION_PATTERN.test(input.correlationId)) {
    throw new Error("invalid_ledger_generation_correlation");
  }
  return input as LedgerGenerationCorrelation;
}

export const ledgerGenerationSchema = {
  parse: parseLedgerGeneration,
  safeParse: (value: unknown): { success: true; data: LedgerGenerationCorrelation } | { success: false; error: Error } => {
    try {
      return { success: true, data: parseLedgerGeneration(value) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error("invalid_ledger_generation_correlation") };
    }
  },
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_ledger_model_output");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error("invalid_ledger_model_output");
};

export async function hashLedgerModelOutput(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ScopeBoundPayload = {
  assessment_document_id: string;
  organization_id: string;
  client_id: string;
};

type PrepareInput = {
  actorUserId: string;
  requestId: string;
  correlation: LedgerGenerationCorrelation;
};

export class LedgerPreparationError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "LedgerPreparationError";
  }
}

type PrepareDependencies<TPayload extends ScopeBoundPayload> = {
  loadAuthoritativePayload: (input: {
    actorUserId: string;
    assessmentDocumentId: string;
    organizationId: string;
    clientId: string;
  }) => Promise<TPayload>;
  beginAttempt: (input: {
    actorUserId: string;
    requestId: string;
    correlation: LedgerGenerationCorrelation;
    workflow: typeof CALOPTIMA_LEDGER_WORKFLOW;
    provider: string;
    model: string;
    promptVersion: string;
    toolVersion: string;
    modelRequestSchemaVersion: string;
    pricingVersion: string;
    temperature: number;
    allowedTools: string[];
  }) => Promise<{
    authoritative: boolean;
    stepId: string;
    attemptId: string;
    attemptStatus: "running" | "completed" | "failed";
    outputHash: string | null;
  }>;
  settleAttemptFailure: (input: {
    actorUserId: string;
    correlation: LedgerGenerationCorrelation;
    stepId: string;
    attemptId: string;
    errorCode:
      | "attempt_snapshot_denied"
      | "authoritative_scope_mismatch"
      | "authoritative_payload_unavailable";
  }) => Promise<void>;
};

export async function prepareLedgerGeneration<TPayload extends ScopeBoundPayload>(
  input: PrepareInput,
  deps: PrepareDependencies<TPayload>,
): Promise<
  | {
    payload: null;
    authoritative: true;
    stepId: string;
    attemptId: string;
    replay: true;
    replayOutputHash: string;
    canTransitionWorkflow: false;
    canPublish: false;
  }
  | {
    payload: TPayload;
    authoritative: true;
    stepId: string;
    attemptId: string;
    replay: false;
    replayOutputHash: null;
    canTransitionWorkflow: false;
    canPublish: false;
  }
> {
  const attempt = await deps.beginAttempt({
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    correlation: input.correlation,
    workflow: CALOPTIMA_LEDGER_WORKFLOW,
    ...CALOPTIMA_LEDGER_MODEL_SNAPSHOT,
    allowedTools: [],
  });
  const hasRunningClaim = attempt.attemptStatus === "running" &&
    UUID_PATTERN.test(attempt.stepId) && UUID_PATTERN.test(attempt.attemptId);
  const settleRunningClaim = async (
    errorCode:
      | "attempt_snapshot_denied"
      | "authoritative_scope_mismatch"
      | "authoritative_payload_unavailable",
  ): Promise<void> => {
    if (!hasRunningClaim) return;
    try {
      await deps.settleAttemptFailure({
        actorUserId: input.actorUserId,
        correlation: input.correlation,
        stepId: attempt.stepId,
        attemptId: attempt.attemptId,
        errorCode,
      });
    } catch {
      throw new LedgerPreparationError("attempt_settlement_failed", 503);
    }
  };
  if (
    attempt.authoritative !== true || !UUID_PATTERN.test(attempt.stepId) ||
    !UUID_PATTERN.test(attempt.attemptId) ||
    (attempt.attemptStatus === "running" && attempt.outputHash !== null) ||
    (attempt.attemptStatus !== "running" &&
      (typeof attempt.outputHash !== "string" || !/^[0-9a-f]{64}$/.test(attempt.outputHash)))
  ) {
    await settleRunningClaim("attempt_snapshot_denied");
    throw new LedgerPreparationError("attempt_snapshot_denied");
  }

  if (attempt.attemptStatus !== "running") {
    return {
      payload: null,
      authoritative: true,
      stepId: attempt.stepId,
      attemptId: attempt.attemptId,
      replay: true,
      replayOutputHash: attempt.outputHash as string,
      canTransitionWorkflow: false,
      canPublish: false,
    };
  }

  let payload: TPayload;
  try {
    payload = await deps.loadAuthoritativePayload({
      actorUserId: input.actorUserId,
      assessmentDocumentId: input.correlation.assessmentDocumentId,
      organizationId: input.correlation.organizationId,
      clientId: input.correlation.clientId,
    });
  } catch {
    await settleRunningClaim("authoritative_payload_unavailable");
    throw new LedgerPreparationError("authoritative_payload_unavailable", 503);
  }
  if (
    payload.assessment_document_id !== input.correlation.assessmentDocumentId ||
    payload.organization_id !== input.correlation.organizationId ||
    payload.client_id !== input.correlation.clientId
  ) {
    await settleRunningClaim("authoritative_scope_mismatch");
    throw new LedgerPreparationError("authoritative_scope_mismatch");
  }

  return {
    payload,
    authoritative: true,
    stepId: attempt.stepId,
    attemptId: attempt.attemptId,
    replay: false,
    replayOutputHash: null,
    canTransitionWorkflow: false,
    canPublish: false,
  };
}
