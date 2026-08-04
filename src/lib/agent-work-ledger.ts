import { z } from "zod";
import { callEdgeFunctionHttp } from "./api";

const runtimeModeSchema = z.enum(["shadow", "advisory"]);
const workItemStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "blocked",
  "needs_review",
  "completed",
  "failed",
  "cancelled",
]);
const stepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting",
  "blocked",
  "needs_approval",
  "completed",
  "skipped",
  "failed",
  "cancelled",
]);

const blockerSchema = z.object({
  code: z.string().min(1),
  stepKey: z.string().min(1),
  action: z.string().min(1),
}).strict();

const stepSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  status: stepStatusSchema,
  executionMode: z.enum(["deterministic", "model_suggested", "human"]),
  evidenceCount: z.number().int().nonnegative(),
  lastReasonCode: z.string().nullable(),
}).strict();

const approvalSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected", "expired", "revoked"]),
  requiredRole: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
  requestedAt: z.string().datetime(),
  evidenceCount: z.number().int().nonnegative().nullable(),
  evidenceHashSuffix: z.string().regex(/^[0-9a-f]{8}$/).nullable(),
  canDecide: z.boolean(),
}).strict();

const workItemSchema = z.object({
  id: z.string().min(1),
  workflowKey: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  objective: z.string().min(1),
  status: workItemStatusSchema,
  risk: z.enum(["low", "moderate", "high", "clinical"]),
  hasOwner: z.boolean(),
  dueAt: z.string().datetime().nullable(),
  blockers: z.array(blockerSchema),
  steps: z.array(stepSchema),
  approvals: z.array(approvalSchema),
  updatedAt: z.string().datetime(),
}).strict();

const listEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(workItemSchema),
  meta: z.object({ runtimeMode: runtimeModeSchema }).strict(),
}).strict();

const approvalEnvelopeSchema = z.object({
  success: z.literal(true),
  data: approvalSchema,
  meta: z.object({ outcome: z.enum(["decided", "duplicate"]) }).strict(),
}).strict();

const approvalHandoffEnvelopeSchema = z.object({
  success: z.literal(true),
  data: approvalSchema,
}).strict();

const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
}).strict();

const detailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: workItemSchema,
  meta: z.object({ runtimeMode: runtimeModeSchema }).strict(),
}).strict();

export const AGENT_WORKFLOW_KEYS = {
  iehpAssessmentPrep: "assessment.iehp.prepare_for_clinical_review",
  caloptimaDraftReview: "assessment.caloptima.prepare_draft_review",
} as const;

export type AgentWorkRuntimeMode = z.infer<typeof runtimeModeSchema>;
export type AgentWorkItem = z.infer<typeof workItemSchema>;
export type AgentWorkApprovalDecision = "approve" | "reject";
export type AgentWorkWorkflowKey = typeof AGENT_WORKFLOW_KEYS[keyof typeof AGENT_WORKFLOW_KEYS];

export type AssessmentWorkLedgerPanelState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "aborted" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "no-ledger"; runtimeMode: AgentWorkRuntimeMode }
  | { kind: "available"; runtimeMode: AgentWorkRuntimeMode; item: AgentWorkItem };

interface FetchAssessmentWorkLedgerInput {
  assessmentDocumentId: string;
  workflowKey?: AgentWorkWorkflowKey;
  signal?: AbortSignal;
}

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

export async function fetchAssessmentWorkLedger({
  assessmentDocumentId,
  workflowKey = AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
  signal,
}: FetchAssessmentWorkLedgerInput): Promise<AssessmentWorkLedgerPanelState> {
  try {
    const searchParams = new URLSearchParams({
      assessment_document_id: assessmentDocumentId,
      workflow_key: workflowKey,
    });
    const response = await callEdgeFunctionHttp(
      `agent-work-items?${searchParams.toString()}`,
      { method: "GET", signal },
    );
    const payload = await parseJson(response);

    if (!response.ok) {
      const errorEnvelope = errorEnvelopeSchema.safeParse(payload);
      if (response.status === 403 && errorEnvelope.success && errorEnvelope.data.code === "runtime_mode_disabled") {
        return { kind: "disabled" };
      }
      if (response.status === 401) {
        return { kind: "unauthorized" };
      }
      if (response.status === 403) return { kind: "forbidden" };
      return { kind: "unavailable" };
    }

    const envelope = listEnvelopeSchema.safeParse(payload);
    if (!envelope.success) return { kind: "unavailable" };
    const { data, meta } = envelope.data;
    if (data.length === 0) {
      return { kind: "no-ledger", runtimeMode: meta.runtimeMode };
    }
    return { kind: "available", runtimeMode: meta.runtimeMode, item: data[0] };
  } catch (error) {
    return isAbortError(error) || signal?.aborted
      ? { kind: "aborted" }
      : { kind: "unavailable" };
  }
}

export async function decideAgentWorkApproval(input: {
  workItemId: string;
  approvalId: string;
  decision: AgentWorkApprovalDecision;
  reasonCode: string;
}): Promise<AgentWorkItem["approvals"][number]> {
  const response = await callEdgeFunctionHttp(
    `agent-work-items/${encodeURIComponent(input.workItemId)}/approvals/${encodeURIComponent(input.approvalId)}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: input.decision, reasonCode: input.reasonCode }),
    },
  );
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error : "Approval decision failed");
  }
  const parsed = approvalEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Approval response was invalid");
  return parsed.data.data;
}

export async function requestAgentWorkApprovalHandoff(input: {
  workItemId: string;
  stepId: string;
  assignedOwnerUserId: string;
  reasonCode: string;
  expiresAt: string;
}): Promise<AgentWorkItem["approvals"][number]> {
  const response = await callEdgeFunctionHttp(
    `agent-work-items/${encodeURIComponent(input.workItemId)}/owner`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stepId: input.stepId,
        assignedOwnerUserId: input.assignedOwnerUserId,
        reasonCode: input.reasonCode,
        expiresAt: input.expiresAt,
      }),
    },
  );
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error : "Approval handoff failed");
  }
  const parsed = approvalHandoffEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Approval handoff response was invalid");
  return parsed.data.data;
}

export async function createCalOptimaDraftReviewWorkLedger(input: {
  assessmentDocumentId: string;
}): Promise<AgentWorkItem> {
  const response = await callEdgeFunctionHttp("agent-work-items/caloptima-draft-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessmentDocumentId: input.assessmentDocumentId }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error : "Work item creation failed");
  }
  const parsed = detailEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Work item creation response was invalid");
  return parsed.data.data;
}

interface AssessmentWorkLedgerQueryScope {
  organizationId: string;
  clientId: string;
  assessmentDocumentId: string;
  authIdentity: string;
  workflowKey?: AgentWorkWorkflowKey;
}

export const createAssessmentWorkLedgerQueryOptions = (
  scope: AssessmentWorkLedgerQueryScope,
) => {
  const workflowKey = scope.workflowKey ?? AGENT_WORKFLOW_KEYS.iehpAssessmentPrep;

  return {
    queryKey: [
      "assessment-work-ledger",
      workflowKey,
      scope.organizationId,
      scope.clientId,
      scope.assessmentDocumentId,
      scope.authIdentity,
    ] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchAssessmentWorkLedger({
        assessmentDocumentId: scope.assessmentDocumentId,
        workflowKey,
        signal,
      }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  };
};

export const createCalOptimaWorkLedgerQueryOptions = (
  scope: Omit<AssessmentWorkLedgerQueryScope, "workflowKey">,
) =>
  createAssessmentWorkLedgerQueryOptions({
    ...scope,
    workflowKey: AGENT_WORKFLOW_KEYS.caloptimaDraftReview,
  });
