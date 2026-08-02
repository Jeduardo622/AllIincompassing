import type { WorkStepStatus } from "./contracts.ts";
import { sanitizeEventMetadata, type SanitizedEventMetadata } from "./events.ts";
import {
  authorizeWorkAction,
  evaluateActorScope,
  type AgentWorkActor,
  type AgentWorkRuntimeMode,
  type AgentWorkScope,
  type WorkflowDefinition,
} from "./policy.ts";

type RpcName = "claim_agent_work_step" | "transition_agent_work_step";

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
  event_type: string;
  sanitized_metadata: Record<string, unknown> | null;
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
  runtimeMode: AgentWorkRuntimeMode | null;
  workflow: WorkflowDefinition;
  workerId: string;
  leaseSeconds: number;
  killSwitchEnabled: boolean;
  now?: Date;
}

export interface TransitionStepInput {
  actor: AgentWorkActor;
  scope: AgentWorkScope;
  runtimeMode: AgentWorkRuntimeMode | null;
  workflow: WorkflowDefinition;
  expectedStateVersion: number;
  toStatus: WorkStepStatus;
  reasonCode: string;
  outputHash: string | null;
  metadata: Record<string, unknown> | null;
  killSwitchEnabled: boolean;
  approval: {
    status: "approved" | "pending" | "rejected" | "expired" | "revoked";
    approvalHash: string;
    expectedApprovalHash: string;
    evidenceHash: string;
    expectedEvidenceHash: string;
    expiresAt: string | null;
  } | null;
  now?: Date;
}

export interface ListEventsInput {
  actor: AgentWorkActor;
  scope: AgentWorkScope;
  limit?: number;
  now?: Date;
}

export class AgentWorkRepository {
  constructor(private readonly client: AgentWorkRepositoryClient) {}

  async claimStep(
    input: ClaimStepInput,
  ): Promise<RepositoryResult<unknown>> {
    const now = input.now ?? new Date();
    const policy = authorizeWorkAction({
      actor: input.actor,
      scope: input.scope,
      runtimeMode: input.runtimeMode,
      workflow: input.workflow,
      killSwitchEnabled: input.killSwitchEnabled,
      action: {
        action: "claim_step",
        workflow: input.workflow.workflow,
        tool: "claim_step",
        approval: null,
        clinicalEffect: false,
        now,
      },
    });

    if (!policy.allowed || !input.scope.workItemId) {
      return { ok: false, reasonCode: policy.allowed ? "scope_missing_or_invalid" : policy.reasonCode };
    }

    const response = await this.client.rpc<unknown>("claim_agent_work_step", {
      p_work_item_id: input.scope.workItemId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });

    if (response.error || response.data == null) {
      return { ok: false, reasonCode: response.error?.message ?? "claim_step_failed" };
    }

    return { ok: true, data: response.data };
  }

  async transitionStep(
    input: TransitionStepInput,
  ): Promise<RepositoryResult<unknown>> {
    const now = input.now ?? new Date();
    const sanitizedMetadata = sanitizeTransitionMetadata(
      input.actor.actorId,
      input.scope,
      input.runtimeMode,
      input.metadata,
    );

    const policy = authorizeWorkAction({
      actor: input.actor,
      scope: input.scope,
      runtimeMode: input.runtimeMode,
      workflow: input.workflow,
      killSwitchEnabled: input.killSwitchEnabled,
      action: {
        action: "transition_step",
        workflow: input.workflow.workflow,
        tool: String(sanitizedMetadata.tool ?? "review_snapshot"),
        approval: input.approval,
        clinicalEffect: false,
        now,
      },
    });

    if (!policy.allowed || !input.scope.stepId) {
      return { ok: false, reasonCode: policy.allowed ? "scope_missing_or_invalid" : policy.reasonCode };
    }

    const response = await this.client.rpc<unknown>("transition_agent_work_step", {
      p_step_id: input.scope.stepId,
      p_expected_state_version: input.expectedStateVersion,
      p_to_status: input.toStatus,
      p_reason_code: input.reasonCode,
      p_output_hash: input.outputHash,
      p_sanitized_metadata: sanitizedMetadata,
    });

    if (response.error || response.data == null) {
      return { ok: false, reasonCode: response.error?.message ?? "transition_step_failed" };
    }

    return { ok: true, data: response.data };
  }

  async listEvents(
    input: ListEventsInput,
  ): Promise<RepositoryResult<ReadonlyArray<AgentWorkEventRow>>> {
    const access = evaluateActorScope(input.actor, input.scope, input.now ?? new Date());
    if (!access.allowed || !input.scope.workItemId) {
      return { ok: false, reasonCode: access.allowed ? "scope_missing_or_invalid" : access.reasonCode };
    }

    const response = await this.client.listEvents({
      workItemId: input.scope.workItemId,
      limit: input.limit ?? 50,
    });

    if (response.error || response.data == null) {
      return { ok: false, reasonCode: response.error?.message ?? "list_events_failed" };
    }

    const sanitizedRows = response.data.map((row) => ({
      ...row,
      sanitized_metadata: sanitizeEventMetadata(row.sanitized_metadata ?? {}),
    }));

    return { ok: true, data: sanitizedRows };
  }
}

function sanitizeTransitionMetadata(
  actorId: string,
  scope: AgentWorkScope,
  runtimeMode: AgentWorkRuntimeMode | null,
  metadata: Record<string, unknown> | null,
): SanitizedEventMetadata {
  const withBoundary = {
    ...(metadata ?? {}),
    actor_id: actorId,
    organization_id: scope.organizationId,
    ...(scope.clientId ? { client_id: scope.clientId } : {}),
    ...(scope.workItemId ? { work_item_id: scope.workItemId } : {}),
    ...(scope.stepId ? { step_id: scope.stepId } : {}),
    ...(runtimeMode ? { runtime_mode: runtimeMode } : {}),
  };

  return sanitizeEventMetadata(withBoundary);
}
