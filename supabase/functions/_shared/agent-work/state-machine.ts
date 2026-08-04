import { createHash } from "node:crypto";
import type {
  ApprovalCurrentInput,
  ApprovalHashInput,
  CancellationPropagationInput,
  DeriveReadyStepsInput,
  LeaseDecision,
  LeaseDecisionInput,
  RetryDecisionInput,
  StateVersionDecision,
  StateVersionInput,
  WorkItemStatus,
  WorkStepDependency,
  WorkStepSnapshot,
  WorkStepStatus,
} from "./contracts.ts";

const TERMINAL_WORK_ITEM_STATUSES = new Set<WorkItemStatus>([
  "needs_review",
  "completed",
  "cancelled",
]);
const TERMINAL_WORK_STEP_STATUSES = new Set<WorkStepStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
const READY_CANDIDATE_STATUSES = new Set<WorkStepStatus>([
  "pending",
  "ready",
  "waiting",
  "failed",
]);

const WORK_ITEM_TRANSITIONS = new Set<string>([
  "queued->running",
  "queued->waiting",
  "queued->blocked",
  "queued->failed",
  "queued->cancelled",
  "running->waiting",
  "running->blocked",
  "running->failed",
  "running->cancelled",
  "running->needs_review",
  "waiting->queued",
  "waiting->running",
  "waiting->blocked",
  "waiting->failed",
  "waiting->cancelled",
  "blocked->queued",
  "blocked->running",
  "blocked->waiting",
  "blocked->failed",
  "blocked->cancelled",
  "failed->queued",
  "failed->running",
  "failed->cancelled",
]);

const STEP_TRANSITIONS = new Set<string>([
  "pending->ready",
  "pending->cancelled",
  "pending->skipped",
  "ready->running",
  "ready->cancelled",
  "ready->skipped",
  "running->waiting",
  "running->needs_approval",
  "running->completed",
  "running->failed",
  "running->ready",
  "running->cancelled",
  "waiting->ready",
  "waiting->failed",
  "waiting->cancelled",
  "needs_approval->ready",
  "needs_approval->completed",
  "needs_approval->failed",
  "failed->ready",
  "failed->cancelled",
]);

export function canTransitionWorkItem(
  from: WorkItemStatus,
  to: WorkItemStatus,
): boolean {
  if (from === to) {
    return false;
  }

  if (TERMINAL_WORK_ITEM_STATUSES.has(from)) {
    return false;
  }

  return WORK_ITEM_TRANSITIONS.has(`${from}->${to}`);
}

export function canTransitionStep(
  from: WorkStepStatus,
  to: WorkStepStatus,
): boolean {
  if (from === to) {
    return false;
  }

  return STEP_TRANSITIONS.has(`${from}->${to}`);
}

export function deriveReadySteps(input: DeriveReadyStepsInput): string[] {
  const stepsById = new Map(input.steps.map((step) => [step.id, step]));
  const dependenciesBySuccessor = groupDependenciesBySuccessor(
    input.dependencies,
  );

  return input.steps
    .filter((step) =>
      isReadyCandidate(
        step,
        stepsById,
        dependenciesBySuccessor,
        input.authoritativeStateVersions,
        input.now,
      )
    )
    .map((step) => step.id);
}

export function deriveWorkItemStatus(
  steps: WorkStepSnapshot[],
): WorkItemStatus {
  if (steps.length === 0) {
    return "queued";
  }

  if (steps.some((step) => step.status === "running")) {
    return "running";
  }

  if (
    steps.some((step) =>
      step.status === "waiting" || step.status === "needs_approval"
    )
  ) {
    return "waiting";
  }

  if (
    steps.some((step) =>
      step.status === "failed" && step.attemptCount >= step.maxAttempts
    )
  ) {
    return "failed";
  }

  if (steps.some((step) => step.status === "failed")) {
    return "blocked";
  }

  if (
    steps.some((step) => step.status === "ready" || step.status === "pending")
  ) {
    return "queued";
  }

  if (steps.every((step) => TERMINAL_WORK_STEP_STATUSES.has(step.status))) {
    if (steps.some((step) => step.status === "cancelled")) {
      return "cancelled";
    }

    return "needs_review";
  }

  return "blocked";
}

export function canonicalApprovalHash(input: ApprovalHashInput): string {
  const canonicalValue = normalizeValue({
    workItemId: input.workItemId,
    stepId: input.stepId,
    requiredRole: input.requiredRole,
    executionMode: input.executionMode,
    inputHash: input.inputHash,
    evidenceHashes: [...input.evidenceHashes].sort(),
    completionCriteria: input.completionCriteria,
    dependencyKeys: [...input.dependencyKeys].sort(),
    toolAllowlist: [...input.toolAllowlist].sort(),
    workflowVersion: input.workflowVersion,
  });
  return createHash("sha256").update(JSON.stringify(canonicalValue)).digest(
    "hex",
  );
}

export function canRetryStep(input: RetryDecisionInput): boolean {
  if (!input.errorClass) {
    return false;
  }

  if (input.attemptCount >= input.maxAttempts) {
    return false;
  }

  return (
    input.errorClass === "transient_provider" ||
    input.errorClass === "transient_network" ||
    input.errorClass === "lease_expired"
  );
}

export function evaluateLease(input: LeaseDecisionInput): LeaseDecision {
  if (input.leaseOwner === null && input.leaseExpiresAt === null) {
    return "available";
  }

  if (
    input.leaseOwner === null || input.leaseExpiresAt === null ||
    input.leaseOwner.length === 0 || input.leaseExpiresAt.length === 0
  ) {
    return "stale";
  }

  const leaseExpiresAt = Date.parse(input.leaseExpiresAt);
  if (
    !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= input.now.getTime()
  ) {
    return "stale";
  }

  return input.leaseOwner === input.workerId
    ? "held_by_worker"
    : "held_by_other";
}

export function evaluateStateVersion(
  input: StateVersionInput,
): StateVersionDecision {
  return input.expectedStateVersion === input.actualStateVersion
    ? "current"
    : "stale";
}

export function isApprovalCurrent(input: ApprovalCurrentInput): boolean {
  if (input.approvalStatus !== "approved") {
    return false;
  }

  if (!input.approvalHash || input.approvalHash !== input.currentApprovalHash) {
    return false;
  }

  if (!input.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(input.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > input.now.getTime();
}

export function deriveCancellationPropagation(
  input: CancellationPropagationInput,
): string[] {
  const stepsById = new Map(input.steps.map((step) => [step.id, step]));
  const successorsByStepId = new Map<string, string[]>();

  for (const dependency of input.dependencies) {
    const current = successorsByStepId.get(dependency.predecessorStepId) ?? [];
    current.push(dependency.successorStepId);
    successorsByStepId.set(dependency.predecessorStepId, current);
  }

  const queue = [...input.cancelledStepIds];
  const visited = new Set(queue);
  const cancelledDependents: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const successorIds = successorsByStepId.get(currentId) ?? [];

    for (const successorId of successorIds) {
      if (visited.has(successorId)) {
        continue;
      }

      visited.add(successorId);
      const successor = stepsById.get(successorId);
      if (!successor || TERMINAL_WORK_STEP_STATUSES.has(successor.status)) {
        continue;
      }

      cancelledDependents.push(successorId);
      queue.push(successorId);
    }
  }

  return cancelledDependents;
}

function isReadyCandidate(
  step: WorkStepSnapshot,
  stepsById: Map<string, WorkStepSnapshot>,
  dependenciesBySuccessor: Map<string, WorkStepDependency[]>,
  authoritativeStateVersions: Readonly<Record<string, number>>,
  now: Date,
): boolean {
  if (!READY_CANDIDATE_STATUSES.has(step.status)) {
    return false;
  }

  const authoritativeStateVersion = authoritativeStateVersions[step.id];
  if (
    typeof authoritativeStateVersion !== "number" ||
    evaluateStateVersion({
        expectedStateVersion: authoritativeStateVersion,
        actualStateVersion: step.stateVersion,
      }) === "stale"
  ) {
    return false;
  }

  if (!isLeaseAvailable(step, now)) {
    return false;
  }

  if (
    step.status === "failed" && !canRetryStep({
      errorClass: step.lastErrorClass,
      attemptCount: step.attemptCount,
      maxAttempts: step.maxAttempts,
    })
  ) {
    return false;
  }

  if (step.wakeAt) {
    const wakeAt = Date.parse(step.wakeAt);
    if (!Number.isFinite(wakeAt) || wakeAt > now.getTime()) {
      return false;
    }
  }

  const dependencies = dependenciesBySuccessor.get(step.id) ?? [];
  for (const dependency of dependencies) {
    const predecessor = stepsById.get(dependency.predecessorStepId);
    if (!predecessor || predecessor.status !== "completed") {
      return false;
    }
  }

  return true;
}

function isLeaseAvailable(step: WorkStepSnapshot, now: Date): boolean {
  if (step.leaseOwner === null && step.leaseExpiresAt === null) {
    return true;
  }

  if (
    step.leaseOwner === null || step.leaseExpiresAt === null ||
    step.leaseOwner.length === 0 || step.leaseExpiresAt.length === 0
  ) {
    return false;
  }

  const leaseExpiresAt = Date.parse(step.leaseExpiresAt);
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= now.getTime();
}

function groupDependenciesBySuccessor(
  dependencies: WorkStepDependency[],
): Map<string, WorkStepDependency[]> {
  const grouped = new Map<string, WorkStepDependency[]>();

  for (const dependency of dependencies) {
    const current = grouped.get(dependency.successorStepId) ?? [];
    current.push(dependency);
    grouped.set(dependency.successorStepId, current);
  }

  return grouped;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeValue(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }

  return value;
}
