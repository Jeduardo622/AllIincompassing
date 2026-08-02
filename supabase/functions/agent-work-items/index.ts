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
}

export interface AgentWorkItemView {
  id: string;
  workflowKey: string;
  workflowVersion: number;
  objective: string;
  status: WorkItemStatus;
  risk: WorkRisk;
  ownerUserId: string | null;
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
  getAuthenticatedUser(request: Request): Promise<{ id: string } | null>;
  loadAssessmentDocumentScope(
    assessmentDocumentId: string,
  ): Promise<AssessmentDocumentScope | null>;
  currentUserCanManage(
    organizationId: string,
    clientId: string,
  ): Promise<boolean>;
  createAssessmentWorkItem(
    input: CreateAssessmentWorkItemInput,
  ): Promise<AgentWorkItemView>;
  listWorkItemsByAssessmentDocument(
    assessmentDocumentId: string,
  ): Promise<AgentWorkItemView[]>;
  getWorkItemDetail(workItemId: string): Promise<AgentWorkItemView | null>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const WORKFLOW_VERSION = 1;
const MAX_BODY_BYTES = 4096;
function strictView(view: AgentWorkItemView): AgentWorkItemView {
  return {
    id: view.id,
    workflowKey: view.workflowKey,
    workflowVersion: view.workflowVersion,
    objective: view.objective,
    status: view.status,
    risk: view.risk,
    ownerUserId: view.ownerUserId,
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
  return /^\/[0-9a-f-]+\/(owner|cancel|resume|reconcile)$/i.test(path) ||
    /^\/[0-9a-f-]+\/approvals\/[0-9a-f-]+\/decision$/i.test(path);
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
      mode = deps.getRuntimeMode();
    } catch {
      mode = "disabled";
    }
    if (!new Set<AgentWorkRuntimeMode>(["shadow", "advisory"]).has(mode)) {
      return reject(403, "Runtime mode disabled", "runtime_mode_disabled");
    }

    const url = new URL(request.url);
    const path = routePath(url.pathname);

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
        return respond(201, { success: true, data: strictView(created) });
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
      try {
        const items = await deps.listWorkItemsByAssessmentDocument(
          assessmentDocumentId,
        );
        return respond(200, { success: true, data: items.map(strictView) });
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
          ? respond(200, { success: true, data: strictView(item) })
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

    const getDetail = async (
      workItemId: string,
    ): Promise<AgentWorkItemView | null> => {
      const { data: item, error: itemError } = await requestClient
        .from("agent_work_items")
        .select(
          "id,workflow_key,workflow_version,objective,status,risk,owner_user_id,due_at,updated_at",
        )
        .eq("id", workItemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) return null;

      const [stepsResult, approvalsResult, evidenceResult] = await Promise.all([
        requestClient
          .from("agent_work_steps")
          .select("id,step_key,status,execution_mode,last_error_code,ordinal")
          .eq("work_item_id", workItemId)
          .order("ordinal", { ascending: true }),
        requestClient
          .from("agent_work_approvals")
          .select("id,step_id,status,required_role,expires_at,requested_at")
          .eq("work_item_id", workItemId)
          .order("requested_at", { ascending: true }),
        requestClient
          .from("agent_work_evidence")
          .select("step_id")
          .eq("work_item_id", workItemId),
      ]);
      if (stepsResult.error) throw stepsResult.error;
      if (approvalsResult.error) throw approvalsResult.error;
      if (evidenceResult.error) throw evidenceResult.error;

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

      return {
        id: item.id,
        workflowKey: item.workflow_key,
        workflowVersion: item.workflow_version,
        objective: item.objective,
        status: item.status,
        risk: item.risk,
        ownerUserId: item.owner_user_id,
        dueAt: item.due_at,
        blockers: (stepsResult.data ?? []).map(blockerForStep).filter((
          value,
        ): value is AgentWorkItemBlockerView => value !== null),
        steps,
        approvals: (approvalsResult.data ?? []).map((
          approval: any,
        ): AgentWorkItemApprovalView => ({
          id: approval.id,
          stepId: approval.step_id,
          status: approval.status,
          requiredRole: approval.required_role,
          expiresAt: approval.expires_at,
        })),
        updatedAt: item.updated_at,
      };
    };

    return createAgentWorkItemsHandler({
      getCorsHeaders: corsHeadersForRequest,
      getRuntimeMode: runtimeMode,
      getAuthenticatedUser: async () => {
        if (!token) return null;
        const { data, error } = await requestClient.auth.getUser(token);
        return error || !data.user ? null : { id: data.user.id };
      },
      loadAssessmentDocumentScope: async (assessmentDocumentId) => {
        const { data, error } = await requestClient
          .from("assessment_documents")
          .select("id,organization_id,client_id,template_type")
          .eq("id", assessmentDocumentId)
          .eq("template_type", "iehp_fba")
          .maybeSingle();
        if (error) throw error;
        return data
          ? {
            id: data.id,
            organizationId: data.organization_id,
            clientId: data.client_id,
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
      listWorkItemsByAssessmentDocument: async (assessmentDocumentId) => {
        const { data, error } = await requestClient
          .from("agent_work_assessment_links")
          .select("work_item_id")
          .eq("assessment_document_id", assessmentDocumentId)
          .eq("workflow_key", "assessment.iehp.prepare_for_clinical_review")
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
    })(request);
  };
}

if (import.meta.main) {
  Deno.serve(createRuntimeHandler());
}
