import { WORK_STEP_STATUSES, type WorkStepStatus } from "./contracts.ts";
import {
  EventMetadataError,
  type SanitizedEventMetadata,
  sanitizeTransitionEventMetadata,
  validateStoredEventMetadata,
} from "./events.ts";
import {
  AGENT_WORK_RUNTIME_MODES,
  type AgentWorkActionName,
  type AgentWorkActor,
  type AgentWorkApprovalContext,
  type AgentWorkRuntimeMode,
  type AgentWorkScope,
  type AgentWorkScopeValidation,
  authorizeWorkAction,
  evaluateActorScope,
  isAgentWorkRuntimeMode,
  validateActorScopeRequest,
  type WorkflowDefinition,
} from "./policy.ts";

type RpcName = "claim_agent_work_step" | "transition_agent_work_step";
type RepositoryOperation = "claim_step" | "transition_step" | "list_events";

export interface AgentWorkRpcError {
  message: string;
}

export interface AgentWorkRpcResponse<TResult> {
  data: TResult | null;
  error: AgentWorkRpcError | null;
}

export interface AgentWorkRepositoryClient {
  rpc<TResult>(
    fn: RpcName,
    params: Readonly<Record<string, unknown>>,
  ): Promise<AgentWorkRpcResponse<TResult>>;
  listEvents(input: {
    workItemId: string;
    limit: number;
  }): Promise<AgentWorkRpcResponse<ReadonlyArray<AgentWorkEventRow>>>;
}

export interface AgentWorkEventRow {
  id: string;
  work_item_id: string;
  step_id: string | null;
  attempt_id: string | null;
  organization_id: string;
  client_id: string | null;
  event_type: string;
  actor_kind: string;
  actor_id: string | null;
  sanitized_metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentWorkRecordBinding {
  organizationId: string;
  clientId: string | null;
  workItemId: string | null;
  stepId: string | null;
  attemptId: string | null;
}

export interface AgentWorkAllowedMachineValues {
  workflows: readonly string[];
  workflowVersions: readonly number[];
  tools: readonly string[];
  reasonCodes: readonly string[];
  resultCodes: readonly string[];
  statuses: readonly WorkStepStatus[];
  workerIds: readonly string[];
}

export interface AgentWorkAuthorityContext {
  runtimeMode: AgentWorkRuntimeMode | null;
  killSwitchEnabled: boolean;
  workflow: WorkflowDefinition;
  action: AgentWorkActionName | null;
  tool: string | null;
  approval: AgentWorkApprovalContext | null;
  recordBinding: AgentWorkRecordBinding;
  allowedMachineValues: AgentWorkAllowedMachineValues;
}

export interface AgentWorkAuthorityLoader {
  loadAuthority(
    input: Readonly<{
      actor: AgentWorkActor;
      scope: AgentWorkScope;
      operation: RepositoryOperation;
      now: Date;
    }>,
  ): Promise<AgentWorkAuthorityContext | null>;
}

export interface RepositoryDecisionFailure {
  ok: false;
  reasonCode: string;
}

export interface RepositorySuccess<TResult> {
  ok: true;
  data: TResult;
}

export type RepositoryResult<TResult> =
  | RepositoryDecisionFailure
  | RepositorySuccess<TResult>;

export interface ClaimStepInput {
  actor: AgentWorkActor;
  scope: AgentWorkScope;
  leaseSeconds: number;
}

export interface TransitionCallerMetadata {
  result_code?: string;
  evidence_hash?: string;
  duration_ms?: number;
  retry_count?: number;
}

export interface TransitionStepInput {
  actor: AgentWorkActor;
  scope: AgentWorkScope;
  expectedStateVersion: number;
  toStatus: WorkStepStatus;
  reasonCode: string;
  outputHash: string | null;
  metadata: TransitionCallerMetadata | null;
}

export interface ListEventsInput {
  actor: AgentWorkActor;
  scope: AgentWorkScope;
  limit?: number;
}

const CLAIM_INPUT_KEYS = ["actor", "scope", "leaseSeconds"] as const;
const TRANSITION_INPUT_KEYS = [
  "actor",
  "scope",
  "expectedStateVersion",
  "toStatus",
  "reasonCode",
  "outputHash",
  "metadata",
] as const;
const LIST_INPUT_KEYS = ["actor", "scope", "limit"] as const;
const SCOPE_KEYS = [
  "organizationId",
  "clientId",
  "workItemId",
  "stepId",
] as const;
const CALLER_METADATA_KEYS = [
  "result_code",
  "evidence_hash",
  "duration_ms",
  "retry_count",
] as const;
const RUNTIME_MODES: readonly AgentWorkRuntimeMode[] = AGENT_WORK_RUNTIME_MODES;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class AgentWorkRepository {
  constructor(
    private readonly client: AgentWorkRepositoryClient,
    private readonly authorityLoader: AgentWorkAuthorityLoader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async claimStep(input: ClaimStepInput): Promise<RepositoryResult<unknown>> {
    const envelope = validateInputEnvelope(input, CLAIM_INPUT_KEYS);
    if (envelope) return envelope;

    const now = this.clock();
    const request = validateActorScopeRequest(input.actor, input.scope, now);
    if (!request.allowed) return failure(request.reasonCode);
    if (input.actor.kind !== "worker") {
      return failure("claim_actor_kind_forbidden");
    }
    if (!input.scope.workItemId || input.scope.stepId !== null) {
      return failure("scope_missing_or_invalid");
    }
    if (
      !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 15 ||
      input.leaseSeconds > 900
    ) {
      return failure("lease_seconds_invalid");
    }

    const loaded = await this.loadAuthority(
      input.actor,
      input.scope,
      "claim_step",
      now,
    );
    if (!loaded.ok) return loaded;
    const authority = loaded.data;
    const binding = validateAuthorityBinding(
      input.scope,
      authority.recordBinding,
    );
    if (binding) return binding;
    if (authority.recordBinding.attemptId !== null) {
      return failure("authority_scope_mismatch");
    }
    const authorityDecision = validateMutationAuthority(
      authority,
      "claim_step",
    );
    if (authorityDecision) return authorityDecision;

    const policy = authorizeWorkAction({
      actor: input.actor,
      scope: input.scope,
      scopeValidation: scopeValidation(authority.recordBinding),
      runtimeMode: authority.runtimeMode,
      workflow: authority.workflow,
      killSwitchEnabled: authority.killSwitchEnabled,
      action: {
        action: "claim_step",
        workflow: authority.workflow.workflow,
        tool: authority.tool as string,
        approval: authority.approval,
        clinicalEffect: false,
        now,
      },
    });
    if (!policy.allowed) return failure(policy.reasonCode);

    const response = await this.client.rpc<unknown>("claim_agent_work_step", {
      p_work_item_id: input.scope.workItemId,
      p_worker_id: input.actor.id,
      p_lease_seconds: input.leaseSeconds,
    });
    return rpcResult(response, "claim_step_failed");
  }

  async transitionStep(
    input: TransitionStepInput,
  ): Promise<RepositoryResult<unknown>> {
    const envelope = validateInputEnvelope(input, TRANSITION_INPUT_KEYS);
    if (envelope) return envelope;
    if (
      input.metadata && hasUnexpectedKeys(input.metadata, CALLER_METADATA_KEYS)
    ) {
      return failure("event_metadata_key_forbidden");
    }

    const now = this.clock();
    const request = validateActorScopeRequest(input.actor, input.scope, now);
    if (!request.allowed) return failure(request.reasonCode);
    if (!input.scope.workItemId || !input.scope.stepId) {
      return failure("scope_missing_or_invalid");
    }
    if (
      !Number.isInteger(input.expectedStateVersion) ||
      input.expectedStateVersion < 0
    ) {
      return failure("state_version_invalid");
    }
    if (input.outputHash !== null && !SHA256_PATTERN.test(input.outputHash)) {
      return failure("output_hash_invalid");
    }

    let sanitizedMetadata: SanitizedEventMetadata;
    try {
      validateStoredEventMetadata({
        reason_code: input.reasonCode,
        to_status: input.toStatus,
      });
      sanitizedMetadata = sanitizeTransitionEventMetadata({
        worker_id: input.actor.id,
        ...(input.metadata ?? {}),
      });
    } catch (error) {
      return eventFailure(error);
    }

    const loaded = await this.loadAuthority(
      input.actor,
      input.scope,
      "transition_step",
      now,
    );
    if (!loaded.ok) return loaded;
    const authority = loaded.data;
    const binding = validateAuthorityBinding(
      input.scope,
      authority.recordBinding,
    );
    if (binding) return binding;
    const authorityDecision = validateMutationAuthority(
      authority,
      "transition_step",
    );
    if (authorityDecision) return authorityDecision;
    if (
      !machineValueAllowed(
        authority.allowedMachineValues.reasonCodes,
        input.reasonCode,
      ) ||
      !machineValueAllowed(
        authority.allowedMachineValues.statuses,
        input.toStatus,
      )
    ) {
      return failure("machine_value_not_allowed");
    }
    const resultCode = sanitizedMetadata.result_code;
    if (
      typeof resultCode === "string" &&
      !machineValueAllowed(
        authority.allowedMachineValues.resultCodes,
        resultCode,
      )
    ) {
      return failure("machine_value_not_allowed");
    }

    try {
      sanitizedMetadata = sanitizeTransitionEventMetadata({
        worker_id: input.actor.id,
        ...(authority.recordBinding.attemptId
          ? { attempt_id: authority.recordBinding.attemptId }
          : {}),
        ...(input.metadata ?? {}),
      });
    } catch (error) {
      return eventFailure(error);
    }

    const policy = authorizeWorkAction({
      actor: input.actor,
      scope: input.scope,
      scopeValidation: scopeValidation(authority.recordBinding),
      runtimeMode: authority.runtimeMode,
      workflow: authority.workflow,
      killSwitchEnabled: authority.killSwitchEnabled,
      action: {
        action: "transition_step",
        workflow: authority.workflow.workflow,
        tool: authority.tool as string,
        approval: authority.approval,
        clinicalEffect: false,
        now,
      },
    });
    if (!policy.allowed) return failure(policy.reasonCode);

    const response = await this.client.rpc<unknown>(
      "transition_agent_work_step",
      {
        p_step_id: input.scope.stepId,
        p_expected_state_version: input.expectedStateVersion,
        p_to_status: input.toStatus,
        p_reason_code: input.reasonCode,
        p_output_hash: input.outputHash,
        p_sanitized_metadata: sanitizedMetadata,
      },
    );
    return rpcResult(response, "transition_step_failed");
  }

  async listEvents(
    input: ListEventsInput,
  ): Promise<RepositoryResult<ReadonlyArray<AgentWorkEventRow>>> {
    const envelope = validateInputEnvelope(input, LIST_INPUT_KEYS);
    if (envelope) return envelope;

    const now = this.clock();
    const request = validateActorScopeRequest(input.actor, input.scope, now);
    if (!request.allowed) return failure(request.reasonCode);
    if (!input.scope.workItemId || input.scope.stepId !== null) {
      return failure("scope_missing_or_invalid");
    }

    const loaded = await this.loadAuthority(
      input.actor,
      input.scope,
      "list_events",
      now,
    );
    if (!loaded.ok) return loaded;
    const authority = loaded.data;
    const binding = validateAuthorityBinding(
      input.scope,
      authority.recordBinding,
    );
    if (binding) return binding;
    const readAuthority = validateAuthorityBase(authority);
    if (readAuthority) return readAuthority;

    const access = evaluateActorScope(
      input.actor,
      input.scope,
      scopeValidation(authority.recordBinding),
      now,
    );
    if (!access.allowed) return failure(access.reasonCode);

    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return failure("list_limit_invalid");
    }
    const response = await this.client.listEvents({
      workItemId: input.scope.workItemId,
      limit,
    });
    if (response.error || response.data == null) {
      return failure("list_events_failed");
    }

    try {
      for (const row of response.data) {
        if (
          row.organization_id !== input.scope.organizationId ||
          row.client_id !== input.scope.clientId ||
          row.work_item_id !== input.scope.workItemId
        ) {
          return failure("authority_scope_mismatch");
        }
        validateStoredEventMetadata(row.sanitized_metadata);
        if (!storedMachineValuesAllowed(row.sanitized_metadata, authority)) {
          return failure("machine_value_not_allowed");
        }
      }
    } catch (error) {
      return eventFailure(error);
    }

    return { ok: true, data: response.data };
  }

  private async loadAuthority(
    actor: AgentWorkActor,
    scope: AgentWorkScope,
    operation: RepositoryOperation,
    now: Date,
  ): Promise<RepositoryResult<AgentWorkAuthorityContext>> {
    try {
      const context = await this.authorityLoader.loadAuthority({
        actor,
        scope,
        operation,
        now,
      });
      if (!context) return failure("authority_context_unavailable");
      return { ok: true, data: context };
    } catch {
      return failure("authority_lookup_failed");
    }
  }
}

function validateInputEnvelope(
  input: unknown,
  keys: readonly string[],
): RepositoryDecisionFailure | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("repository_input_invalid");
  }
  if (hasUnexpectedKeys(input, keys)) {
    return failure("repository_input_key_forbidden");
  }
  const scope = (input as { scope?: unknown }).scope;
  if (
    scope && typeof scope === "object" && !Array.isArray(scope) &&
    hasUnexpectedKeys(scope, SCOPE_KEYS)
  ) {
    return failure("repository_input_key_forbidden");
  }
  return null;
}

function hasUnexpectedKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).some((key) => !allowed.has(key));
}

function validateAuthorityBinding(
  scope: AgentWorkScope,
  binding: AgentWorkRecordBinding,
): RepositoryDecisionFailure | null {
  if (
    !binding ||
    binding.organizationId !== scope.organizationId ||
    binding.clientId !== scope.clientId ||
    binding.workItemId !== scope.workItemId ||
    binding.stepId !== scope.stepId
  ) {
    return failure("authority_scope_mismatch");
  }
  return null;
}

function validateAuthorityBase(
  authority: AgentWorkAuthorityContext,
): RepositoryDecisionFailure | null {
  try {
    if (
      !authority.workflow ||
      !authority.allowedMachineValues ||
      !machineValueAllowed(
        authority.allowedMachineValues.workflows,
        authority.workflow.workflow,
      ) ||
      !authority.allowedMachineValues.workflowVersions.includes(
        authority.workflow.version,
      )
    ) {
      return failure("authority_context_invalid");
    }
  } catch {
    return failure("authority_context_invalid");
  }
  return null;
}

function validateMutationAuthority(
  authority: AgentWorkAuthorityContext,
  expectedAction: AgentWorkActionName,
): RepositoryDecisionFailure | null {
  const base = validateAuthorityBase(authority);
  if (base) return base;
  if (typeof authority.killSwitchEnabled !== "boolean") {
    return failure("authority_context_invalid");
  }
  if (
    !isAgentWorkRuntimeMode(authority.runtimeMode) ||
    !RUNTIME_MODES.includes(authority.runtimeMode)
  ) {
    return failure("runtime_mode_unavailable");
  }
  if (authority.action !== expectedAction) {
    return failure("authority_action_mismatch");
  }
  if (
    !authority.tool ||
    !machineValueAllowed(authority.allowedMachineValues.tools, authority.tool)
  ) {
    return failure("forbidden_tool");
  }
  const actionDefinition = authority.workflow.actions?.[expectedAction];
  if (
    !actionDefinition ||
    !Array.isArray(actionDefinition.allowedRuntimeModes) ||
    !Array.isArray(actionDefinition.requiredRoles) ||
    !Array.isArray(actionDefinition.allowedTools) ||
    typeof actionDefinition.clinicalEffect !== "boolean" ||
    typeof actionDefinition.requiresCurrentApproval !== "boolean"
  ) {
    return failure("authority_context_invalid");
  }
  return null;
}

function scopeValidation(
  binding: AgentWorkRecordBinding,
): AgentWorkScopeValidation {
  return {
    verdict: "in_scope",
    source: "authority_loader",
    authoritative: true,
    validatedOrganizationId: binding.organizationId,
    validatedClientId: binding.clientId,
    validatedWorkItemId: binding.workItemId,
    validatedStepId: binding.stepId,
  };
}

function storedMachineValuesAllowed(
  metadata: Record<string, unknown>,
  authority: AgentWorkAuthorityContext,
): boolean {
  const allowed = authority.allowedMachineValues;
  return optionalAllowed(metadata.workflow_key, allowed.workflows) &&
    optionalAllowed(metadata.workflow_version, allowed.workflowVersions) &&
    optionalAllowed(metadata.reason_code, allowed.reasonCodes) &&
    optionalAllowed(metadata.result_code, allowed.resultCodes) &&
    optionalAllowed(metadata.to_status, allowed.statuses) &&
    optionalAllowed(metadata.worker_id, allowed.workerIds);
}

function optionalAllowed<T>(value: unknown, allowed: readonly T[]): boolean {
  return value === undefined || allowed.includes(value as T);
}

function machineValueAllowed<T>(allowed: readonly T[], value: T): boolean {
  return Array.isArray(allowed) && allowed.includes(value);
}

function eventFailure(error: unknown): RepositoryDecisionFailure {
  if (error instanceof EventMetadataError) return failure(error.code);
  return failure("event_metadata_invalid");
}

function rpcResult<TResult>(
  response: AgentWorkRpcResponse<TResult>,
  fallback: string,
): RepositoryResult<TResult> {
  if (response.error || response.data == null) {
    return failure(fallback);
  }
  return { ok: true, data: response.data };
}

function failure(reasonCode: string): RepositoryDecisionFailure {
  return { ok: false, reasonCode };
}
