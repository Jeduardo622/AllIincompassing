export const WORK_ITEM_STATUSES = [
  "queued",
  "running",
  "waiting",
  "needs_review",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting",
  "needs_approval",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;

export type WorkStepStatus = (typeof WORK_STEP_STATUSES)[number];

export const WORK_EXECUTION_MODES = ["deterministic", "model_suggested", "human"] as const;
export type WorkExecutionMode = (typeof WORK_EXECUTION_MODES)[number];

export const WORK_APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "revoked"] as const;
export type WorkApprovalStatus = (typeof WORK_APPROVAL_STATUSES)[number];

export const RETRYABLE_ERROR_CLASSES = [
  "transient_provider",
  "transient_network",
  "lease_expired",
] as const;

export const NON_RETRYABLE_ERROR_CLASSES = [
  "policy",
  "tenant",
  "validation",
  "stale_approval",
  "forbidden_tool",
  "unknown",
] as const;

export type RetryableErrorClass = (typeof RETRYABLE_ERROR_CLASSES)[number];
export type NonRetryableErrorClass = (typeof NON_RETRYABLE_ERROR_CLASSES)[number];
export type WorkStepErrorClass = RetryableErrorClass | NonRetryableErrorClass;

export type LeaseDecision = "available" | "held_by_worker" | "held_by_other" | "stale";
export type StateVersionDecision = "current" | "stale";

export type WorkStepSnapshot = {
  id: string;
  stepKey: string;
  status: WorkStepStatus;
  executionMode: WorkExecutionMode;
  stateVersion: number;
  attemptCount: number;
  maxAttempts: number;
  wakeAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  requiredRole: string | null;
  approvalHash: string | null;
  inputHash: string | null;
  outputHash: string | null;
  lastErrorClass: WorkStepErrorClass | null;
};

export type WorkStepDependency = {
  predecessorStepId: string;
  successorStepId: string;
};

export type RetryDecisionInput = {
  errorClass: WorkStepErrorClass | null;
  attemptCount: number;
  maxAttempts: number;
};

export type LeaseDecisionInput = {
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  workerId: string;
  now: Date;
};

export type StateVersionInput = {
  expectedStateVersion: number;
  actualStateVersion: number;
};

export type ApprovalHashInput = {
  workItemId: string;
  stepId: string;
  requiredRole: string;
  executionMode: WorkExecutionMode;
  inputHash: string;
  evidenceHashes: string[];
  completionCriteria: Record<string, unknown>;
  dependencyKeys: string[];
  toolAllowlist: string[];
  workflowVersion: number;
};

export type ApprovalCurrentInput = {
  approvalStatus: WorkApprovalStatus;
  approvalHash: string | null;
  currentApprovalHash: string;
  expiresAt: string | null;
  now: Date;
};

export type CancellationPropagationInput = {
  steps: WorkStepSnapshot[];
  dependencies: WorkStepDependency[];
  cancelledStepIds: string[];
};

export type DeriveReadyStepsInput = {
  steps: WorkStepSnapshot[];
  dependencies: WorkStepDependency[];
  now: Date;
};

export type ServerWorkflowAuthority = Pick<
  ApprovalHashInput,
  | "requiredRole"
  | "executionMode"
  | "completionCriteria"
  | "dependencyKeys"
  | "toolAllowlist"
  | "workflowVersion"
>;

export type ModelStepSuggestion = {
  proposedStatus?: WorkStepStatus;
  proposedExecutionMode?: WorkExecutionMode;
  proposedDependencyKeys?: string[];
  proposedToolAllowlist?: string[];
  proposedCompletionCriteria?: Record<string, unknown>;
};
