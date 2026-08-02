export type AgentWorkRuntimeMode = "disabled" | "shadow" | "advisory" | "active";
export type AgentWorkActorKind = "human_user" | "system_service" | "service_role";
export type AgentWorkActionName =
  | "claim_step"
  | "transition_step"
  | "record_projection";
export type AgentWorkScopeVerdict =
  | "in_scope"
  | "wrong_organization"
  | "wrong_client"
  | "missing_or_invalid";

export interface AgentWorkActorRoleBinding {
  organizationId: string;
  role: string;
  active: boolean;
  expiresAt: string | null;
}

export interface AgentWorkActor {
  actorId: string;
  actorKind: AgentWorkActorKind;
  orgRoleBindings: AgentWorkActorRoleBinding[];
}

export interface AgentWorkScopeValidation {
  verdict: AgentWorkScopeVerdict;
  source: "repository" | "projection" | "rpc";
  authoritative: boolean;
  validatedOrganizationId: string;
  validatedClientId: string | null;
}

export interface AgentWorkScope {
  organizationId: string;
  clientId: string | null;
  workItemId: string | null;
  stepId: string | null;
  validation: AgentWorkScopeValidation;
}

export interface AgentWorkApprovalContext {
  status: "approved" | "pending" | "rejected" | "expired" | "revoked";
  approvalHash: string;
  expectedApprovalHash: string;
  evidenceHash: string;
  expectedEvidenceHash: string;
  expiresAt: string | null;
}

export interface AgentWorkAction {
  action: AgentWorkActionName;
  workflow: string;
  tool: string;
  approval: AgentWorkApprovalContext | null;
  clinicalEffect: boolean;
  now: Date;
}

export interface WorkflowActionDefinition {
  allowedRuntimeModes: readonly AgentWorkRuntimeMode[];
  requiredRoles: readonly string[];
  allowedTools: readonly string[];
  clinicalEffect: boolean;
  requiresCurrentApproval: boolean;
}

export interface WorkflowDefinition {
  workflow: string;
  version: number;
  actions: Readonly<Record<string, WorkflowActionDefinition>>;
}

export interface PolicyDecision {
  allowed: boolean;
  reasonCode: string;
  runtimeMode: AgentWorkRuntimeMode | null;
  allowedTool: string | null;
}

export interface PolicyAuthorizationInput {
  actor: AgentWorkActor | null;
  scope: AgentWorkScope | null;
  runtimeMode: AgentWorkRuntimeMode | null;
  action: AgentWorkAction;
  workflow: WorkflowDefinition;
  killSwitchEnabled: boolean;
}

const ACTOR_KINDS = new Set<AgentWorkActorKind>([
  "human_user",
  "system_service",
  "service_role",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function authorizeWorkAction(
  input: PolicyAuthorizationInput,
): PolicyDecision {
  const identity = evaluateActorScope(input.actor, input.scope, input.action.now);
  if (!identity.allowed) {
    return deny(identity.reasonCode, input.runtimeMode);
  }

  if (input.runtimeMode == null) {
    return deny("runtime_mode_unavailable", null);
  }

  if (input.killSwitchEnabled) {
    return deny("runtime_kill_switch_enabled", input.runtimeMode);
  }

  if (input.action.workflow !== input.workflow.workflow) {
    return deny("unknown_workflow", input.runtimeMode);
  }

  const actionDefinition = input.workflow.actions[input.action.action];
  if (!actionDefinition) {
    return deny("unknown_action", input.runtimeMode);
  }

  if (input.runtimeMode === "disabled") {
    return deny("runtime_mode_disabled", input.runtimeMode);
  }

  if (input.action.clinicalEffect || actionDefinition.clinicalEffect) {
    return deny("clinical_effects_forbidden", input.runtimeMode);
  }

  if (input.runtimeMode === "shadow" && input.action.action !== "record_projection") {
    return deny("shadow_mode_projection_only", input.runtimeMode);
  }

  if (input.runtimeMode === "advisory" && input.action.action !== "record_projection") {
    return deny("advisory_mode_projection_only", input.runtimeMode);
  }

  if (!actionDefinition.allowedRuntimeModes.includes(input.runtimeMode)) {
    return deny("runtime_mode_not_permitted", input.runtimeMode);
  }

  if (!actionDefinition.allowedTools.includes(input.action.tool)) {
    return deny("forbidden_tool", input.runtimeMode);
  }

  if (!identity.role || !actionDefinition.requiredRoles.includes(identity.role)) {
    return deny("insufficient_role", input.runtimeMode);
  }

  if (actionDefinition.requiresCurrentApproval) {
    const approvalDecision = isApprovalCurrent(input.action.approval, input.action.now);
    if (!approvalDecision.allowed) {
      return deny(approvalDecision.reasonCode, input.runtimeMode);
    }
  }

  return {
    allowed: true,
    reasonCode: "allowed",
    runtimeMode: input.runtimeMode,
    allowedTool: input.action.tool,
  };
}

export function evaluateActorScope(
  actor: AgentWorkActor | null,
  scope: AgentWorkScope | null,
  now: Date,
): PolicyDecision & { role: string | null } {
  if (!actor || typeof actor !== "object") {
    return { ...deny("actor_required", null), role: null };
  }

  if (
    !actor.actorId ||
    !UUID_PATTERN.test(actor.actorId) ||
    !ACTOR_KINDS.has(actor.actorKind)
  ) {
    return { ...deny("actor_required", null), role: null };
  }

  if (!scope || typeof scope !== "object") {
    return { ...deny("scope_required", null), role: null };
  }

  if (
    !UUID_PATTERN.test(scope.organizationId) ||
    (scope.clientId !== null && !UUID_PATTERN.test(scope.clientId)) ||
    (scope.workItemId !== null && !UUID_PATTERN.test(scope.workItemId)) ||
    (scope.stepId !== null && !UUID_PATTERN.test(scope.stepId))
  ) {
    return { ...deny("scope_missing_or_invalid", null), role: null };
  }

  if (
    !scope.validation.authoritative ||
    scope.validation.verdict !== "in_scope" ||
    scope.validation.validatedOrganizationId !== scope.organizationId ||
    scope.validation.validatedClientId !== scope.clientId
  ) {
    return { ...deny("scope_mismatch", null), role: null };
  }

  const membership = actor.orgRoleBindings.find((binding) =>
    binding.organizationId === scope.organizationId
  );

  if (!membership) {
    return { ...deny("inactive_membership", null), role: null };
  }

  if (!membership.active || isExpired(membership.expiresAt, now)) {
    return { ...deny("inactive_membership", null), role: null };
  }

  return {
    allowed: true,
    reasonCode: "allowed",
    runtimeMode: null,
    allowedTool: null,
    role: membership.role,
  };
}

function isApprovalCurrent(
  approval: AgentWorkApprovalContext | null,
  now: Date,
): { allowed: boolean; reasonCode: string } {
  if (!approval || approval.status !== "approved") {
    return { allowed: false, reasonCode: "stale_approval" };
  }

  if (
    !SHA256_PATTERN.test(approval.approvalHash) ||
    !SHA256_PATTERN.test(approval.expectedApprovalHash) ||
    approval.approvalHash !== approval.expectedApprovalHash
  ) {
    return { allowed: false, reasonCode: "stale_approval" };
  }

  if (
    !SHA256_PATTERN.test(approval.evidenceHash) ||
    !SHA256_PATTERN.test(approval.expectedEvidenceHash) ||
    approval.evidenceHash !== approval.expectedEvidenceHash
  ) {
    return { allowed: false, reasonCode: "stale_evidence_hash" };
  }

  if (isExpired(approval.expiresAt, now)) {
    return { allowed: false, reasonCode: "stale_approval" };
  }

  return { allowed: true, reasonCode: "allowed" };
}

function isExpired(value: string | null, now: Date): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function deny(
  reasonCode: string,
  runtimeMode: AgentWorkRuntimeMode | null,
): PolicyDecision {
  return {
    allowed: false,
    reasonCode,
    runtimeMode,
    allowedTool: null,
  };
}
