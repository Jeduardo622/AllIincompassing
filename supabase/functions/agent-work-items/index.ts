// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.99.0";
import { corsHeadersForRequest } from "../_shared/cors.ts";

export type AgentWorkRuntimeMode = "disabled" | "shadow" | "advisory";
export type WorkItemStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkRisk = "low" | "moderate" | "high" | "clinical";
export type WorkStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "needs_approval"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled";
export type WorkExecutionMode = "deterministic" | "model_suggested" | "human";
export type SupportedWorkflowKey =
  | "assessment.iehp.prepare_for_clinical_review"
  | "assessment.caloptima.prepare_draft_review";

export interface AgentWorkItemBlockerView {
  code: string;
  stepKey: string;
  action: string;
}

export interface AgentWorkItemStepView {
  id: string;
  key: string;
  status: WorkStepStatus;
  executionMode: WorkExecutionMode;
  evidenceCount: number;
  lastReasonCode: string | null;
}

export interface AgentWorkItemApprovalView {
  id: string;
  stepId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "revoked";
  requiredRole: string;
  expiresAt: string | null;
  requestedAt: string;
  evidenceCount: number | null;
  evidenceHashSuffix: string | null;
  canDecide: boolean;
}

export interface AgentWorkItemView {
  id: string;
  workflowKey: string;
  workflowVersion: number;
  objective: string;
  status: WorkItemStatus;
  risk: WorkRisk;
  hasOwner: boolean;
  dueAt: string | null;
  blockers: AgentWorkItemBlockerView[];
  steps: AgentWorkItemStepView[];
  approvals: AgentWorkItemApprovalView[];
  updatedAt: string;
}

interface AssessmentDocumentScope {
  id: string;
  organizationId: string;
  clientId: string;
}

interface CreateAssessmentWorkItemInput {
  actorUserId: string;
  organizationId: string;
  clientId: string;
  assessmentDocumentId: string;
  workflowVersion: number;
  dedupeKey: string;
}

interface CreateCalOptimaDraftReviewWorkItemInput {
  actorUserId: string;
  organizationId: string;
  clientId: string;
  assessmentDocumentId: string;
  workflowVersion: number;
  dedupeKey: string;
}

interface RequestApprovalHandoffInput {
  actorUserId: string;
  workItemId: string;
  stepId: string;
  assignedOwnerUserId: string;
  reasonCode: string;
  expiresAt: string;
}

interface DecideApprovalInput {
  actorUserId: string;
  workItemId: string;
  approvalId: string;
  decision: "approve" | "reject";
  reasonCode: string;
}

interface RefreshCalOptimaEvidenceInput {
  actorUserId: string;
  workItemId: string;
}

type ApprovalDecisionOutcome =
  | "decided"
  | "duplicate"
  | "conflict"
  | "expired"
  | "revoked"
  | "forbidden"
  | "not_found";

interface ApprovalDecisionResult {
  outcome: ApprovalDecisionOutcome;
  approval: AgentWorkItemApprovalView | null;
}

export class AgentWorkRequestError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly publicMessage: "Forbidden" | "Not found" | "Conflict",
    readonly code: "forbidden" | "not_found" | "conflict",
  ) {
    super(code);
    this.name = "AgentWorkRequestError";
  }
}

export interface AgentWorkItemsHandlerDependencies {
  getCorsHeaders(request: Request): Record<string, string>;
  getRuntimeMode(): AgentWorkRuntimeMode;
  loadRuntimePolicy(): Promise<AgentWorkRuntimeMode>;
  getAuthenticatedUser(request: Request): Promise<{ id: string } | null>;
  loadAssessmentDocumentScope(
    assessmentDocumentId: string,
    workflowKey: SupportedWorkflowKey,
    actorUserId: string,
  ): Promise<AssessmentDocumentScope | null>;
  currentUserCanManage(
    organizationId: string,
    clientId: string,
  ): Promise<boolean>;
  createAssessmentWorkItem(
    input: CreateAssessmentWorkItemInput,
  ): Promise<AgentWorkItemView>;
  createCalOptimaDraftReviewWorkItem(
    input: CreateCalOptimaDraftReviewWorkItemInput,
  ): Promise<AgentWorkItemView>;
  listWorkItemsByAssessmentDocument(
    assessmentDocumentId: string,
    workflowKey: SupportedWorkflowKey,
  ): Promise<AgentWorkItemView[]>;
  getWorkItemDetail(workItemId: string): Promise<AgentWorkItemView | null>;
  refreshCalOptimaEvidence(
    input: RefreshCalOptimaEvidenceInput,
  ): Promise<boolean>;
  requestApprovalHandoff(
    input: RequestApprovalHandoffInput,
  ): Promise<AgentWorkItemApprovalView>;
  decideApproval(input: DecideApprovalInput): Promise<ApprovalDecisionResult>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WORKFLOW_VERSION = 1;
const MAX_BODY_BYTES = 4096;
const IEHP_WORKFLOW_KEY = "assessment.iehp.prepare_for_clinical_review";
const CALOPTIMA_DRAFT_REVIEW_WORKFLOW_KEY =
  "assessment.caloptima.prepare_draft_review";

function isSupportedWorkflowKey(
  value: string | null,
): value is SupportedWorkflowKey {
  return value === IEHP_WORKFLOW_KEY ||
    value === CALOPTIMA_DRAFT_REVIEW_WORKFLOW_KEY;
}

function strictView(view: AgentWorkItemView): AgentWorkItemView {
  return {
    id: view.id,
    workflowKey: view.workflowKey,
    workflowVersion: view.workflowVersion,
    objective: view.objective,
    status: view.status,
    risk: view.risk,
    hasOwner: view.hasOwner,
    dueAt: view.dueAt,
    blockers: view.blockers.map((blocker) => ({
      code: blocker.code,
      stepKey: blocker.stepKey,
      action: blocker.action,
    })),
    steps: view.steps.map((step) => ({
      id: step.id,
      key: step.key,
      status: step.status,
      executionMode: step.executionMode,
      evidenceCount: step.evidenceCount,
      lastReasonCode: step.lastReasonCode,
    })),
    approvals: view.approvals.map((approval) => ({
      id: approval.id,
      stepId: approval.stepId,
      status: approval.status,
      requiredRole: approval.requiredRole,
      expiresAt: approval.expiresAt,
      requestedAt: approval.requestedAt,
      evidenceCount: approval.evidenceCount,
      evidenceHashSuffix: approval.evidenceHashSuffix,
      canDecide: approval.canDecide,
    })),
    updatedAt: view.updatedAt,
  };
}

function routePath(pathname: string): string {
  const marker = "/agent-work-items";
  const markerIndex = pathname.lastIndexOf(marker);
  if (markerIndex < 0) return pathname;
  const suffix = pathname.slice(markerIndex + marker.length);
  return suffix.length === 0 ? "/" : suffix;
}

function isDeferredMutation(path: string): boolean {
  return /^\/[0-9a-f-]+\/(cancel|resume|reconcile)$/i.test(path);
}

async function parseCreateBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return null;
  }
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validateCreateBody(body: Record<string, unknown>): {
  assessmentDocumentId: string;
  workflowVersion: number;
} | null {
  const allowed = new Set(["assessmentDocumentId", "workflowVersion"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (
    typeof body.assessmentDocumentId !== "string" ||
    !UUID_PATTERN.test(body.assessmentDocumentId)
  ) {
    return null;
  }
  const workflowVersion = body.workflowVersion ?? WORKFLOW_VERSION;
  if (!Number.isInteger(workflowVersion)) return null;
  return {
    assessmentDocumentId: body.assessmentDocumentId,
    workflowVersion: workflowVersion as number,
  };
}

function validateHandoffBody(body: Record<string, unknown>): {
  stepId: string;
  assignedOwnerUserId: string;
  reasonCode: string;
  expiresAt: string;
} | null {
  const allowed = new Set([
    "stepId",
    "assignedOwnerUserId",
    "reasonCode",
    "expiresAt",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (
    typeof body.stepId !== "string" || !UUID_PATTERN.test(body.stepId) ||
    typeof body.assignedOwnerUserId !== "string" ||
    !UUID_PATTERN.test(body.assignedOwnerUserId) ||
    typeof body.reasonCode !== "string" ||
    !REASON_CODE_PATTERN.test(body.reasonCode) ||
    typeof body.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.expiresAt))
  ) return null;
  return {
    stepId: body.stepId,
    assignedOwnerUserId: body.assignedOwnerUserId,
    reasonCode: body.reasonCode,
    expiresAt: body.expiresAt,
  };
}

function validateDecisionBody(body: Record<string, unknown>): {
  decision: "approve" | "reject";
  reasonCode: string;
} | null {
  const allowed = new Set(["decision", "reasonCode"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (
    (body.decision !== "approve" && body.decision !== "reject") ||
    typeof body.reasonCode !== "string" ||
    !REASON_CODE_PATTERN.test(body.reasonCode)
  ) return null;
  return { decision: body.decision, reasonCode: body.reasonCode };
}

function strictApproval(
  view: AgentWorkItemApprovalView,
): AgentWorkItemApprovalView {
  return {
    id: view.id,
    stepId: view.stepId,
    status: view.status,
    requiredRole: view.requiredRole,
    expiresAt: view.expiresAt,
    requestedAt: view.requestedAt,
    evidenceCount: view.evidenceCount,
    evidenceHashSuffix: view.evidenceHashSuffix,
    canDecide: view.canDecide,
  };
}

export function createAgentWorkItemsHandler(
  deps: AgentWorkItemsHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const responseHeaders = {
      ...deps.getCorsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const respond = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), { status, headers: responseHeaders });
    const reject = (status: number, error: string, code?: string) =>
      respond(status, {
        success: false,
        error,
        ...(code ? { code } : {}),
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    let user: { id: string } | null;
    try {
      user = await deps.getAuthenticatedUser(request);
    } catch {
      return reject(401, "Unauthorized");
    }
    if (!user) return reject(401, "Unauthorized");

    let mode: AgentWorkRuntimeMode;
    try {
      mode = await deps.loadRuntimePolicy();
    } catch {
      mode = "disabled";
    }
    if (!new Set<AgentWorkRuntimeMode>(["shadow", "advisory"]).has(mode)) {
      return reject(403, "Runtime mode disabled", "runtime_mode_disabled");
    }

    const url = new URL(request.url);
    const path = routePath(url.pathname);

    const ownerMatch = path.match(/^\/([0-9a-f-]+)\/owner$/i);
    if (request.method === "POST" && ownerMatch) {
      if (mode !== "advisory") {
        return reject(403, "Advisory mode required", "advisory_mode_required");
      }
      if (!UUID_PATTERN.test(ownerMatch[1])) {
        return reject(400, "Invalid work item id");
      }
      const body = await parseCreateBody(request);
      const input = body ? validateHandoffBody(body) : null;
      if (!input) return reject(400, "Invalid request body");
      try {
        await deps.refreshCalOptimaEvidence({
          actorUserId: user.id,
          workItemId: ownerMatch[1],
        });
        const approval = await deps.requestApprovalHandoff({
          actorUserId: user.id,
          workItemId: ownerMatch[1],
          ...input,
        });
        return respond(201, { success: true, data: strictApproval(approval) });
      } catch (error) {
        if (error instanceof AgentWorkRequestError) {
          return reject(error.status, error.publicMessage, error.code);
        }
        return reject(500, "Approval handoff failed", "handoff_failed");
      }
    }

    const decisionMatch = path.match(
      /^\/([0-9a-f-]+)\/approvals\/([0-9a-f-]+)\/decision$/i,
    );
    if (request.method === "POST" && decisionMatch) {
      if (mode !== "advisory") {
        return reject(403, "Advisory mode required", "advisory_mode_required");
      }
      if (
        !UUID_PATTERN.test(decisionMatch[1]) ||
        !UUID_PATTERN.test(decisionMatch[2])
      ) {
        return reject(400, "Invalid approval target");
      }
      const body = await parseCreateBody(request);
      const input = body ? validateDecisionBody(body) : null;
      if (!input) return reject(400, "Invalid request body");
      try {
        const result = await deps.decideApproval({
          actorUserId: user.id,
          workItemId: decisionMatch[1],
          approvalId: decisionMatch[2],
          ...input,
        });
        if (
          (result.outcome === "decided" || result.outcome === "duplicate") &&
          result.approval
        ) {
          return respond(200, {
            success: true,
            data: strictApproval(result.approval),
            meta: { outcome: result.outcome },
          });
        }
        const mapped: Partial<
          Record<ApprovalDecisionOutcome, [number, string, string]>
        > = {
          forbidden: [403, "Forbidden", "forbidden"],
          not_found: [404, "Not found", "not_found"],
          conflict: [409, "Conflict", "conflict"],
          expired: [409, "Conflict", "approval_expired"],
          revoked: [409, "Conflict", "approval_revoked"],
        };
        const mappedOutcome = mapped[result.outcome];
        return mappedOutcome
          ? reject(mappedOutcome[0], mappedOutcome[1], mappedOutcome[2])
          : reject(409, "Conflict", "conflict");
      } catch (error) {
        if (error instanceof AgentWorkRequestError) {
          return reject(error.status, error.publicMessage, error.code);
        }
        return reject(500, "Approval decision failed", "decision_failed");
      }
    }

    const reconcileMatch = path.match(/^\/([0-9a-f-]+)\/reconcile$/i);
    if (request.method === "POST" && reconcileMatch && mode === "advisory") {
      if (!UUID_PATTERN.test(reconcileMatch[1])) {
        return reject(400, "Invalid work item id");
      }
      try {
        const refreshed = await deps.refreshCalOptimaEvidence({
          actorUserId: user.id,
          workItemId: reconcileMatch[1],
        });
        if (!refreshed) {
          return reject(
            501,
            "Route deferred pending authoritative RPC",
            "deferred_route",
          );
        }
        const item = await deps.getWorkItemDetail(reconcileMatch[1]);
        return item
          ? respond(200, {
            success: true,
            data: strictView(item),
            meta: { runtimeMode: mode },
          })
          : reject(404, "Not found");
      } catch (error) {
        if (error instanceof AgentWorkRequestError) {
          return reject(error.status, error.publicMessage, error.code);
        }
        return reject(500, "Evidence refresh failed", "refresh_failed");
      }
    }

    if (request.method === "POST" && isDeferredMutation(path)) {
      return reject(
        501,
        "Route deferred pending authoritative RPC",
        "deferred_route",
      );
    }

    if (request.method === "POST" && path === "/assessment-prep") {
      const body = await parseCreateBody(request);
      const input = body ? validateCreateBody(body) : null;
      if (!input) return reject(400, "Invalid request body");
      if (input.workflowVersion !== WORKFLOW_VERSION) {
        return reject(
          400,
          "Unsupported workflow version",
          "unsupported_workflow_version",
        );
      }
      try {
        const scope = await deps.loadAssessmentDocumentScope(
          input.assessmentDocumentId,
          IEHP_WORKFLOW_KEY,
          user.id,
        );
        if (!scope) return reject(404, "Not found");
        if (
          !await deps.currentUserCanManage(
            scope.organizationId,
            scope.clientId,
          )
        ) {
          return reject(403, "Forbidden");
        }
        const created = await deps.createAssessmentWorkItem({
          actorUserId: user.id,
          organizationId: scope.organizationId,
          clientId: scope.clientId,
          assessmentDocumentId: scope.id,
          workflowVersion: input.workflowVersion,
          dedupeKey: `assessment-prep:${scope.id}:v${input.workflowVersion}`,
        });
        return respond(201, {
          success: true,
          data: strictView(created),
          meta: { runtimeMode: mode },
        });
      } catch (error) {
        if (error instanceof AgentWorkRequestError) {
          return reject(error.status, error.publicMessage, error.code);
        }
        return reject(500, "Work item creation failed", "create_failed");
      }
    }

    if (request.method === "POST" && path === "/caloptima-draft-review") {
      const body = await parseCreateBody(request);
      const input = body ? validateCreateBody(body) : null;
      if (!input) return reject(400, "Invalid request body");
      if (input.workflowVersion !== WORKFLOW_VERSION) {
        return reject(
          400,
          "Unsupported workflow version",
          "unsupported_workflow_version",
        );
      }
      try {
        const scope = await deps.loadAssessmentDocumentScope(
          input.assessmentDocumentId,
          CALOPTIMA_DRAFT_REVIEW_WORKFLOW_KEY,
          user.id,
        );
        if (!scope) return reject(404, "Not found");
        if (
          !await deps.currentUserCanManage(
            scope.organizationId,
            scope.clientId,
          )
        ) {
          return reject(403, "Forbidden");
        }
        const created = await deps.createCalOptimaDraftReviewWorkItem({
          actorUserId: user.id,
          organizationId: scope.organizationId,
          clientId: scope.clientId,
          assessmentDocumentId: scope.id,
          workflowVersion: input.workflowVersion,
          dedupeKey:
            `caloptima-draft-review:${scope.id}:v${input.workflowVersion}`,
        });
        return respond(201, {
          success: true,
          data: strictView(created),
          meta: { runtimeMode: mode },
        });
      } catch (error) {
        if (error instanceof AgentWorkRequestError) {
          return reject(error.status, error.publicMessage, error.code);
        }
        return reject(500, "Work item creation failed", "create_failed");
      }
    }

    if (request.method === "GET" && path === "/") {
      const assessmentDocumentId = url.searchParams.get(
        "assessment_document_id",
      );
      if (!assessmentDocumentId || !UUID_PATTERN.test(assessmentDocumentId)) {
        return reject(400, "Invalid assessment_document_id");
      }
      const workflowKey = url.searchParams.get("workflow_key");
      if (workflowKey !== null && !isSupportedWorkflowKey(workflowKey)) {
        return reject(400, "Invalid workflow_key");
      }
      try {
        const items = await deps.listWorkItemsByAssessmentDocument(
          assessmentDocumentId,
          workflowKey ?? IEHP_WORKFLOW_KEY,
        );
        return respond(200, {
          success: true,
          data: items.map(strictView),
          meta: { runtimeMode: mode },
        });
      } catch {
        return reject(500, "Work item lookup failed", "lookup_failed");
      }
    }

    const detailMatch = path.match(/^\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      if (!UUID_PATTERN.test(detailMatch[1])) {
        return reject(400, "Invalid work item id");
      }
      try {
        const item = await deps.getWorkItemDetail(detailMatch[1]);
        return item
          ? respond(200, {
            success: true,
            data: strictView(item),
            meta: { runtimeMode: mode },
          })
          : reject(404, "Not found");
      } catch {
        return reject(500, "Work item lookup failed", "lookup_failed");
      }
    }

    return reject(404, "Not found");
  };
}

function runtimeMode(): AgentWorkRuntimeMode {
  const configured =
    (Deno.env.get("AGENT_WORK_LEDGER_RUNTIME_MODE") ?? "disabled").trim()
      .toLowerCase();
  return configured === "shadow" || configured === "advisory"
    ? configured
    : "disabled";
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeReasonCode(value: unknown): string | null {
  return typeof value === "string" && REASON_CODE_PATTERN.test(value)
    ? value
    : null;
}

function requestErrorForRpcMessage(
  message: string,
): AgentWorkRequestError | null {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("forbidden") ||
    normalized.includes("owner") && normalized.includes("role")
  ) {
    return new AgentWorkRequestError(403, "Forbidden", "forbidden");
  }
  if (normalized.includes("not found")) {
    return new AgentWorkRequestError(404, "Not found", "not_found");
  }
  if (
    normalized.includes("conflict") || normalized.includes("unavailable") ||
    normalized.includes("cancelled") || normalized.includes("expired") ||
    normalized.includes("stale")
  ) {
    return new AgentWorkRequestError(409, "Conflict", "conflict");
  }
  return null;
}

function blockerForStep(step: any): AgentWorkItemBlockerView | null {
  if (step.status === "needs_approval") {
    return {
      code: "approval_required",
      stepKey: step.step_key,
      action: "complete_human_review",
    };
  }
  if (step.status === "blocked") {
    return {
      code: "step_blocked",
      stepKey: step.step_key,
      action: "resolve_blocker",
    };
  }
  if (step.status === "failed") {
    return {
      code: "step_failed",
      stepKey: step.step_key,
      action: "retry_or_review",
    };
  }
  return null;
}

function createRuntimeHandler(): (request: Request) => Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";

  return async (request: Request): Promise<Response> => {
    const token = bearerToken(request);
    const requestClient = createClient(supabaseUrl, anonKey, {
      global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const currentUserCanReadWorkItem = async (
      workItemId: string,
    ): Promise<boolean> => {
      const { data, error } = await requestClient.rpc(
        "current_user_can_read_agent_work_item_endpoint",
        { p_work_item_id: workItemId },
      );
      if (error) {
        console.error(
          "agent-work-items visibility check failed",
          error.code ?? "unknown",
        );
        throw error;
      }
      return data === true;
    };

    const getDetail = async (
      workItemId: string,
    ): Promise<AgentWorkItemView | null> => {
      if (!await currentUserCanReadWorkItem(workItemId)) return null;

      const { data: item, error: itemError } = await serviceClient
        .from("agent_work_items")
        .select(
          "id,workflow_key,workflow_version,objective,status,risk,owner_user_id,due_at,updated_at",
        )
        .eq("id", workItemId)
        .maybeSingle();
      if (itemError) {
        console.error(
          "agent-work-items detail read failed",
          itemError.code ?? "unknown",
        );
        throw itemError;
      }
      if (!item) {
        console.error("agent-work-items detail not visible");
        return null;
      }

      const [visibleAuthority, decisionAuthority] = await Promise.all([
        requestClient.rpc(
          "current_user_visible_agent_work_approval_ids",
          { p_work_item_id: workItemId },
        ),
        requestClient.rpc(
          "current_user_decidable_agent_work_approval_ids",
          { p_work_item_id: workItemId },
        ),
      ]);
      if (visibleAuthority.error || decisionAuthority.error) {
        console.error(
          "agent-work-items approval authority read failed",
          visibleAuthority.error?.code ?? decisionAuthority.error?.code ??
            "unknown",
        );
        throw visibleAuthority.error ?? decisionAuthority.error;
      }
      const visibleApprovalIds = (visibleAuthority.data ?? []).map((
        row: any,
      ) => row.approval_id);
      const decidableApprovalIds = new Set(
        (decisionAuthority.data ?? []).map((row: any) => row.approval_id),
      );

      const approvalRead = visibleApprovalIds.length > 0
        ? serviceClient
          .from("agent_work_approvals")
          .select(
            "id,step_id,status,required_role,expires_at,requested_at,evidence_hash",
          )
          .eq("work_item_id", workItemId)
          .in("id", visibleApprovalIds)
          .order("requested_at", { ascending: true })
        : Promise.resolve({ data: [], error: null });

      const [stepsResult, approvalsResult, evidenceResult] = await Promise.all([
        serviceClient
          .from("agent_work_steps")
          .select("id,step_key,status,execution_mode,last_error_code,ordinal")
          .eq("work_item_id", workItemId)
          .order("ordinal", { ascending: true }),
        approvalRead,
        serviceClient
          .from("agent_work_evidence")
          .select("step_id")
          .eq("work_item_id", workItemId),
      ]);
      if (stepsResult.error) {
        console.error(
          "agent-work-items step read failed",
          stepsResult.error.code ?? "unknown",
        );
        throw stepsResult.error;
      }
      if (approvalsResult.error) {
        console.error(
          "agent-work-items approval read failed",
          approvalsResult.error.code ?? "unknown",
        );
        throw approvalsResult.error;
      }
      if (evidenceResult.error) {
        console.error(
          "agent-work-items evidence read failed",
          evidenceResult.error.code ?? "unknown",
        );
        throw evidenceResult.error;
      }

      const evidenceCounts = new Map<string, number>();
      for (const evidence of evidenceResult.data ?? []) {
        if (evidence.step_id) {
          evidenceCounts.set(
            evidence.step_id,
            (evidenceCounts.get(evidence.step_id) ?? 0) + 1,
          );
        }
      }
      const steps = (stepsResult.data ?? []).map((
        step: any,
      ): AgentWorkItemStepView => ({
        id: step.id,
        key: step.step_key,
        status: step.status,
        executionMode: step.execution_mode,
        evidenceCount: evidenceCounts.get(step.id) ?? 0,
        lastReasonCode: safeReasonCode(step.last_error_code),
      }));
      const approvals = (approvalsResult.data ?? []).map(
        (approval: any): AgentWorkItemApprovalView => {
          const isPending = approval.status === "pending";
          return {
            id: approval.id,
            stepId: approval.step_id,
            status: approval.status,
            requiredRole: approval.required_role,
            expiresAt: approval.expires_at,
            requestedAt: approval.requested_at,
            evidenceCount: isPending
              ? (evidenceResult.data ?? []).length
              : null,
            evidenceHashSuffix:
              isPending && typeof approval.evidence_hash === "string"
                ? approval.evidence_hash.slice(-8)
                : null,
            canDecide: isPending && decidableApprovalIds.has(approval.id),
          };
        },
      );

      return {
        id: item.id,
        workflowKey: item.workflow_key,
        workflowVersion: item.workflow_version,
        objective: item.objective,
        status: item.status,
        risk: item.risk,
        hasOwner: typeof item.owner_user_id === "string",
        dueAt: item.due_at,
        blockers: (stepsResult.data ?? []).map(blockerForStep).filter((
          value,
        ): value is AgentWorkItemBlockerView => value !== null),
        steps,
        approvals,
        updatedAt: item.updated_at,
      };
    };

    return createAgentWorkItemsHandler({
      getCorsHeaders: corsHeadersForRequest,
      getRuntimeMode: runtimeMode,
      loadRuntimePolicy: async () => {
        const { data, error } = await serviceClient.rpc(
          "load_agent_work_runtime_policy",
          { p_mode_input: runtimeMode() },
        );
        const row = Array.isArray(data)
          ? data[0] as Record<string, unknown> | undefined
          : undefined;
        if (
          error || !row || row.authoritative !== true ||
          typeof row.runtimeMode !== "string" ||
          typeof row.actionsDisabled !== "boolean" ||
          typeof row.killSwitchEnabled !== "boolean"
        ) {
          throw new Error("runtime_policy_unavailable");
        }
        if (row.actionsDisabled || row.killSwitchEnabled) return "disabled";
        if (
          row.runtimeMode !== "disabled" && row.runtimeMode !== "shadow" &&
          row.runtimeMode !== "advisory"
        ) {
          throw new Error("runtime_policy_unavailable");
        }
        return row.runtimeMode;
      },
      getAuthenticatedUser: async () => {
        if (!token) return null;
        const { data, error } = await requestClient.auth.getUser(token);
        return error || !data.user ? null : { id: data.user.id };
      },
      loadAssessmentDocumentScope: async (
        assessmentDocumentId,
        workflowKey,
        actorUserId,
      ) => {
        const { data, error } = await serviceClient.rpc(
          "resolve_agent_work_assessment_scope",
          {
            p_actor_user_id: actorUserId,
            p_assessment_document_id: assessmentDocumentId,
            p_workflow_key: workflowKey,
            p_workflow_version: WORKFLOW_VERSION,
          },
        );
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row
          ? {
            id: row.id,
            organizationId: row.organization_id,
            clientId: row.client_id,
          }
          : null;
      },
      currentUserCanManage: async (organizationId, clientId) => {
        const { data, error } = await requestClient.rpc(
          "current_user_can_manage_agent_work_row",
          {
            p_organization_id: organizationId,
            p_client_id: clientId,
          },
        );
        if (error) throw error;
        return data === true;
      },
      createAssessmentWorkItem: async (input) => {
        const { data, error } = await serviceClient.rpc(
          "create_agent_assessment_work_item",
          {
            p_actor_user_id: input.actorUserId,
            p_organization_id: input.organizationId,
            p_client_id: input.clientId,
            p_assessment_document_id: input.assessmentDocumentId,
            p_workflow_version: input.workflowVersion,
            p_dedupe_key: input.dedupeKey,
          },
        );
        if (error) {
          console.error(
            "agent-work-items IEHP create RPC failed",
            error.code ?? "unknown",
          );
          const message = error.message.toLowerCase();
          if (message.includes("forbidden")) {
            throw new AgentWorkRequestError(403, "Forbidden", "forbidden");
          }
          if (message.includes("assessment document scope mismatch")) {
            throw new AgentWorkRequestError(404, "Not found", "not_found");
          }
          if (message.includes("dedupe key scope mismatch")) {
            throw new AgentWorkRequestError(409, "Conflict", "conflict");
          }
          throw error;
        }
        if (typeof data !== "string") {
          throw new Error("Create RPC returned no id");
        }
        const detail = await getDetail(data);
        if (!detail) {
          throw new Error("Created item is not visible to the requesting user");
        }
        return detail;
      },
      createCalOptimaDraftReviewWorkItem: async (input) => {
        const { data, error } = await serviceClient.rpc(
          "create_agent_caloptima_draft_review_work_item",
          {
            p_actor_user_id: input.actorUserId,
            p_organization_id: input.organizationId,
            p_client_id: input.clientId,
            p_assessment_document_id: input.assessmentDocumentId,
            p_workflow_version: input.workflowVersion,
            p_dedupe_key: input.dedupeKey,
          },
        );
        if (error) {
          console.error(
            "agent-work-items CalOptima create RPC failed",
            error.code ?? "unknown",
          );
          const message = error.message.toLowerCase();
          if (message.includes("forbidden")) {
            throw new AgentWorkRequestError(403, "Forbidden", "forbidden");
          }
          if (
            message.includes("assessment document scope mismatch") ||
            message.includes("not found")
          ) {
            throw new AgentWorkRequestError(404, "Not found", "not_found");
          }
          if (
            message.includes("dedupe key scope mismatch") ||
            message.includes("conflict")
          ) {
            throw new AgentWorkRequestError(409, "Conflict", "conflict");
          }
          throw error;
        }
        if (typeof data !== "string") {
          throw new Error("Create RPC returned no id");
        }
        const detail = await getDetail(data);
        if (!detail) {
          throw new Error("Created item is not visible to the requesting user");
        }
        return detail;
      },
      listWorkItemsByAssessmentDocument: async (
        assessmentDocumentId,
        workflowKey,
      ) => {
        const { data: canRead, error: visibilityError } = await requestClient
          .rpc(
            "current_user_can_read_agent_work_assessment_endpoint",
            {
              p_assessment_document_id: assessmentDocumentId,
              p_workflow_key: workflowKey,
              p_workflow_version: WORKFLOW_VERSION,
            },
          );
        if (visibilityError) throw visibilityError;
        if (canRead !== true) return [];

        const { data, error } = await serviceClient
          .from("agent_work_assessment_links")
          .select("work_item_id")
          .eq("assessment_document_id", assessmentDocumentId)
          .eq("workflow_key", workflowKey)
          .eq("workflow_version", WORKFLOW_VERSION)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const details = await Promise.all(
          (data ?? []).map((link: any) => getDetail(link.work_item_id)),
        );
        return details.filter((item): item is AgentWorkItemView =>
          item !== null
        );
      },
      getWorkItemDetail: getDetail,
      refreshCalOptimaEvidence: async (input) => {
        if (!await currentUserCanReadWorkItem(input.workItemId)) {
          throw new AgentWorkRequestError(404, "Not found", "not_found");
        }
        const { data: item, error: itemError } = await serviceClient
          .from("agent_work_items")
          .select("organization_id,client_id,workflow_key")
          .eq("id", input.workItemId)
          .maybeSingle();
        if (itemError) throw itemError;
        if (!item) {
          throw new AgentWorkRequestError(404, "Not found", "not_found");
        }
        if (item.workflow_key !== CALOPTIMA_DRAFT_REVIEW_WORKFLOW_KEY) {
          return false;
        }

        const { error } = await serviceClient.rpc(
          "refresh_agent_work_caloptima_evidence",
          {
            p_actor_user_id: input.actorUserId,
            p_organization_id: item.organization_id,
            p_client_id: item.client_id,
            p_work_item_id: input.workItemId,
          },
        );
        if (error) throw requestErrorForRpcMessage(error.message) ?? error;
        return true;
      },
      requestApprovalHandoff: async (input) => {
        const { data, error } = await serviceClient.rpc(
          "request_agent_work_approval_handoff",
          {
            p_actor_user_id: input.actorUserId,
            p_work_item_id: input.workItemId,
            p_step_id: input.stepId,
            p_assigned_owner_user_id: input.assignedOwnerUserId,
            p_reason_code: input.reasonCode,
            p_expires_at: input.expiresAt,
          },
        );
        if (error) throw requestErrorForRpcMessage(error.message) ?? error;
        const approvalId = data && typeof data === "object" &&
            typeof (data as Record<string, unknown>).approval_id === "string"
          ? (data as Record<string, string>).approval_id
          : null;
        const detail = await getDetail(input.workItemId);
        const approval = detail?.approvals.find((candidate) =>
          candidate.id === approvalId
        );
        if (!approval) {
          throw new Error("Approval handoff result was not visible");
        }
        return approval;
      },
      decideApproval: async (input) => {
        const { data, error } = await serviceClient.rpc(
          "decide_agent_work_approval",
          {
            p_actor_user_id: input.actorUserId,
            p_work_item_id: input.workItemId,
            p_approval_id: input.approvalId,
            p_decision: input.decision,
            p_reason_code: input.reasonCode,
          },
        );
        if (error) throw requestErrorForRpcMessage(error.message) ?? error;
        const payload = data && typeof data === "object"
          ? data as Record<string, unknown>
          : {};
        const outcome = typeof payload.outcome === "string"
          ? payload.outcome as ApprovalDecisionOutcome
          : "conflict";
        if (outcome !== "decided" && outcome !== "duplicate") {
          return { outcome, approval: null };
        }
        const { data: approval, error: approvalError } = await serviceClient
          .from("agent_work_approvals")
          .select("id,step_id,status,required_role,expires_at,requested_at")
          .eq("work_item_id", input.workItemId)
          .eq("assigned_to", input.actorUserId)
          .eq("id", input.approvalId)
          .maybeSingle();
        if (approvalError) throw approvalError;
        return {
          outcome,
          approval: approval
            ? {
              id: approval.id,
              stepId: approval.step_id,
              status: approval.status,
              requiredRole: approval.required_role,
              expiresAt: approval.expires_at,
              requestedAt: approval.requested_at,
              evidenceCount: null,
              evidenceHashSuffix: null,
              canDecide: false,
            }
            : null,
        };
      },
    })(request);
  };
}

if (import.meta.main) {
  Deno.serve(createRuntimeHandler());
}
