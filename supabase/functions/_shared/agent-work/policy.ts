export type AgentWorkRuntimeMode =
  | "disabled"
  | "shadow"
  | "advisory";
export type AgentWorkActorKind = "user" | "worker" | "system" | "service_role";
export type AgentWorkActionName =
  | "claim_step"
  | "transition_step"
  | "record_projection";
export type AgentWorkScopeVerdict =
  | "in_scope"
  | "wrong_organization"
  | "wrong_client"
  | "wrong_work_item"
  | "wrong_step"
  | "missing_or_invalid";

export interface AgentWorkActorRoleBinding {
  organizationId: string;
  role: string;
  active: boolean;
  expiresAt: string | null;
}

export interface AgentWorkActor {
  id: string;
  kind: AgentWorkActorKind;
  currentOrgRoles: AgentWorkActorRoleBinding[];
}

export interface AgentWorkScopeValidation {
  verdict: AgentWorkScopeVerdict;
  source: "authority_loader";
  authoritative: boolean;
  validatedOrganizationId: string;
  validatedClientId: string | null;
  validatedWorkItemId: string | null;
  validatedStepId: string | null;
}

export interface AgentWorkScope {
  organizationId: string;
  clientId: string | null;
  workItemId: string | null;
  stepId: string | null;
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
  scopeValidation: AgentWorkScopeValidation | null;
  runtimeMode: AgentWorkRuntimeMode | null;
  action: AgentWorkAction;
  workflow: WorkflowDefinition;
  killSwitchEnabled: boolean;
}

const ACTOR_KINDS = new Set<AgentWorkActorKind>([
  "user",
  "worker",
  "system",
  "service_role",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REMEDIATION_SUGGESTION_KEYS = new Set([
  "blockerCode",
  "suggestedActionCode",
  "evidenceSourceIds",
  "confidence",
  "requiresHumanReview",
]);
export const AGENT_WORK_RUNTIME_MODES = [
  "disabled",
  "shadow",
  "advisory",
] as const satisfies readonly AgentWorkRuntimeMode[];

export type ModelPolicyDecision = {
  allowed: boolean;
  reasonCode: string;
};

export type RemediationSuggestionDecision = ModelPolicyDecision & {
  suggestion?: AssessmentRemediationSuggestion;
};

export function validateModelAttemptScope(
  correlation: AgentWorkModelCorrelation,
  authority: AgentWorkModelAttemptAuthority | null,
): ModelPolicyDecision {
  if (!authority) return modelDeny("unknown_attempt");
  if (!isValidModelCorrelation(correlation)) {
    return modelDeny("scope_missing_or_invalid");
  }

  if (
    authority.organizationId !== correlation.organizationId ||
    authority.clientId !== correlation.clientId ||
    authority.workItemId !== correlation.workItemId ||
    authority.stepId !== correlation.stepId ||
    authority.attemptId !== correlation.attemptId ||
    authority.workflowVersion !== correlation.workflowVersion ||
    authority.correlationId !== correlation.correlationId
  ) {
    return modelDeny("scope_mismatch");
  }
  if (
    authority.attemptStatus !== "running" ||
    !isSafeCode(authority.workflowKey) ||
    !isSafeCode(authority.stepKey)
  ) {
    return modelDeny("attempt_not_runnable");
  }
  if (
    !authority.promptVersion || !isSafeVersion(authority.promptVersion) ||
    !authority.toolVersion || !isSafeVersion(authority.toolVersion)
  ) {
    return modelDeny("attempt_snapshot_incomplete");
  }
  if (
    !isSafeToolList(authority.allowedTools) ||
    !isSafeToolList(authority.guardedTools) ||
    !isSafeCodeList(authority.blockerCodes, true) ||
    !isSafeCodeList(authority.suggestedActionCodes, true) ||
    !isUuidList(authority.evidenceSourceIds, true)
  ) {
    return modelDeny("attempt_policy_invalid");
  }

  return { allowed: true, reasonCode: "allowed" };
}

export function validateModelToolInvocation(
  tool: string,
  policy: Pick<AgentWorkModelAttemptAuthority, "allowedTools" | "guardedTools">,
): ModelPolicyDecision {
  if (!isSafeCode(tool) || !policy.allowedTools.includes(tool)) {
    return modelDeny("forbidden_tool");
  }
  if (!policy.guardedTools.includes(tool)) {
    return modelDeny("unguarded_tool");
  }
  return { allowed: true, reasonCode: "allowed" };
}

export function validateAssessmentRemediationSuggestion(
  value: unknown,
  allowlist: AssessmentRemediationAllowlist,
): RemediationSuggestionDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return modelDeny("model_output_invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !REMEDIATION_SUGGESTION_KEYS.has(key))
  ) {
    return modelDeny("model_output_key_forbidden");
  }

  const blockerCode = record.blockerCode;
  const suggestedActionCode = record.suggestedActionCode;
  const evidenceSourceIds = record.evidenceSourceIds;
  const confidence = record.confidence;
  if (
    typeof blockerCode !== "string" ||
    !isSafeCode(blockerCode) ||
    !allowlist.blockerCodes.includes(blockerCode) ||
    typeof suggestedActionCode !== "string" ||
    !isSafeCode(suggestedActionCode) ||
    !allowlist.suggestedActionCodes.includes(suggestedActionCode) ||
    !Array.isArray(evidenceSourceIds) ||
    evidenceSourceIds.length === 0 ||
    evidenceSourceIds.some((id) =>
      typeof id !== "string" ||
      !UUID_PATTERN.test(id) ||
      !allowlist.evidenceSourceIds.includes(id)
    ) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 || confidence > 1 ||
    record.requiresHumanReview !== true
  ) {
    return modelDeny("model_output_invalid");
  }

  return {
    allowed: true,
    reasonCode: "allowed",
    suggestion: {
      blockerCode,
      suggestedActionCode,
      evidenceSourceIds: [...new Set(evidenceSourceIds as string[])],
      confidence,
      requiresHumanReview: true,
    },
  };
}

export function authorizeWorkAction(
  input: PolicyAuthorizationInput,
): PolicyDecision {
  const identity = evaluateActorScope(
    input.actor,
    input.scope,
    input.scopeValidation,
    input.action.now,
  );
  if (!identity.allowed) return deny(identity.reasonCode, input.runtimeMode);

  if (!isAgentWorkRuntimeMode(input.runtimeMode)) {
    return deny("runtime_mode_unavailable", null);
  }
  if (input.killSwitchEnabled) {
    return deny("runtime_kill_switch_enabled", input.runtimeMode);
  }
  if (input.action.workflow !== input.workflow.workflow) {
    return deny("unknown_workflow", input.runtimeMode);
  }

  const actionDefinition = input.workflow.actions[input.action.action];
  if (!actionDefinition) return deny("unknown_action", input.runtimeMode);
  if (input.runtimeMode === "disabled") {
    return deny("runtime_mode_disabled", input.runtimeMode);
  }
  if (input.action.clinicalEffect || actionDefinition.clinicalEffect) {
    return deny("clinical_effects_forbidden", input.runtimeMode);
  }
  if (
    input.runtimeMode === "shadow" &&
    input.action.action !== "record_projection"
  ) {
    return deny("shadow_mode_projection_only", input.runtimeMode);
  }
  if (
    input.runtimeMode === "advisory" &&
    input.action.action !== "record_projection"
  ) {
    const advisoryActionAllowed = input.action.action === "claim_step" ||
      input.action.action === "transition_step";
    if (
      !advisoryActionAllowed ||
      !actionDefinition.allowedRuntimeModes.includes("advisory")
    ) {
      return deny("advisory_mode_projection_only", input.runtimeMode);
    }
  }
  if (!actionDefinition.allowedRuntimeModes.includes(input.runtimeMode)) {
    return deny("runtime_mode_not_permitted", input.runtimeMode);
  }
  if (!actionDefinition.allowedTools.includes(input.action.tool)) {
    return deny("forbidden_tool", input.runtimeMode);
  }
  if (
    !identity.role || !actionDefinition.requiredRoles.includes(identity.role)
  ) {
    return deny("insufficient_role", input.runtimeMode);
  }
  if (actionDefinition.requiresCurrentApproval) {
    const approvalDecision = isApprovalCurrent(
      input.action.approval,
      input.action.now,
    );
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

export function validateActorScopeRequest(
  actor: AgentWorkActor | null,
  scope: AgentWorkScope | null,
  now: Date,
): PolicyDecision & { role: string | null } {
  if (!actor || typeof actor !== "object") {
    return { ...deny("actor_required", null), role: null };
  }
  if (
    !actor.id || !UUID_PATTERN.test(actor.id) || !ACTOR_KINDS.has(actor.kind)
  ) {
    return { ...deny("actor_required", null), role: null };
  }
  if (!Array.isArray(actor.currentOrgRoles)) {
    return { ...deny("actor_required", null), role: null };
  }
  if (
    actor.currentOrgRoles.some((binding) =>
      !binding ||
      !UUID_PATTERN.test(binding.organizationId) ||
      typeof binding.role !== "string" ||
      !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(binding.role) ||
      typeof binding.active !== "boolean" ||
      (binding.expiresAt !== null && typeof binding.expiresAt !== "string")
    )
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

  const membership = actor.currentOrgRoles.find((binding) =>
    binding.organizationId === scope.organizationId
  );
  if (
    !membership || !membership.active || isExpired(membership.expiresAt, now)
  ) {
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

export function evaluateActorScope(
  actor: AgentWorkActor | null,
  scope: AgentWorkScope | null,
  validation: AgentWorkScopeValidation | null,
  now: Date,
): PolicyDecision & { role: string | null } {
  const request = validateActorScopeRequest(actor, scope, now);
  if (!request.allowed || !scope) return request;

  if (
    !validation ||
    !validation.authoritative ||
    validation.source !== "authority_loader" ||
    validation.verdict !== "in_scope" ||
    validation.validatedOrganizationId !== scope.organizationId ||
    validation.validatedClientId !== scope.clientId ||
    validation.validatedWorkItemId !== scope.workItemId ||
    validation.validatedStepId !== scope.stepId
  ) {
    return { ...deny("scope_mismatch", null), role: null };
  }

  return request;
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
  if (!value) return false;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function deny(
  reasonCode: string,
  runtimeMode: AgentWorkRuntimeMode | null,
): PolicyDecision {
  return { allowed: false, reasonCode, runtimeMode, allowedTool: null };
}

function modelDeny(reasonCode: string): ModelPolicyDecision {
  return { allowed: false, reasonCode };
}

export function isAgentWorkRuntimeMode(
  value: AgentWorkRuntimeMode | string | null | undefined,
): value is AgentWorkRuntimeMode {
  return typeof value === "string" &&
    AGENT_WORK_RUNTIME_MODES.includes(value as AgentWorkRuntimeMode);
}

function isValidModelCorrelation(
  correlation: AgentWorkModelCorrelation,
): boolean {
  return UUID_PATTERN.test(correlation.organizationId) &&
    (correlation.clientId === null ||
      UUID_PATTERN.test(correlation.clientId)) &&
    UUID_PATTERN.test(correlation.workItemId) &&
    UUID_PATTERN.test(correlation.stepId) &&
    UUID_PATTERN.test(correlation.attemptId) &&
    Number.isInteger(correlation.workflowVersion) &&
    correlation.workflowVersion > 0 &&
    SAFE_CORRELATION_PATTERN.test(correlation.correlationId);
}

function isSafeVersion(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value);
}

function isSafeCode(value: string): boolean {
  return SAFE_CODE_PATTERN.test(value);
}

function isSafeToolList(value: string[]): boolean {
  return Array.isArray(value) && value.every((tool) => isSafeCode(tool)) &&
    new Set(value).size === value.length;
}

function isSafeCodeList(value: string[], requireNonEmpty: boolean): boolean {
  return Array.isArray(value) && (!requireNonEmpty || value.length > 0) &&
    value.every((entry) => isSafeCode(entry)) &&
    new Set(value).size === value.length;
}

function isUuidList(value: string[], requireNonEmpty: boolean): boolean {
  return Array.isArray(value) && (!requireNonEmpty || value.length > 0) &&
    value.every((entry) => UUID_PATTERN.test(entry)) &&
    new Set(value).size === value.length;
}
import type {
  AgentWorkModelAttemptAuthority,
  AgentWorkModelCorrelation,
  AssessmentRemediationAllowlist,
  AssessmentRemediationSuggestion,
} from "./contracts.ts";
