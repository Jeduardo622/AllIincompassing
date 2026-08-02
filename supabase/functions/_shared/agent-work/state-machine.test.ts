import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  canonicalApprovalHash,
  canRetryStep,
  canTransitionStep,
  canTransitionWorkItem,
  deriveCancellationPropagation,
  deriveReadySteps,
  deriveWorkItemStatus,
  evaluateLease,
  evaluateStateVersion,
  isApprovalCurrent,
} from "./state-machine.ts";
import type {
  ApprovalHashInput,
  DeriveReadyStepsInput,
  RetryDecisionInput,
  WorkStepSnapshot,
} from "./contracts.ts";

const WORK_ITEM_STATUSES = [
  "queued",
  "running",
  "waiting",
  "needs_review",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

const WORK_STEP_STATUSES = [
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

const STEP_TRANSITIONS = new Set([
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

const WORK_ITEM_TRANSITIONS = new Set([
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

function buildStep(
  overrides: Partial<WorkStepSnapshot> = {},
): WorkStepSnapshot {
  return {
    id: "step-1",
    stepKey: "step_1",
    status: "pending",
    executionMode: "deterministic",
    stateVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    wakeAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    requiredRole: null,
    approvalHash: null,
    inputHash: null,
    outputHash: null,
    lastErrorClass: null,
    ...overrides,
  };
}

Deno.test("canTransitionWorkItem covers every status pair", () => {
  for (const from of WORK_ITEM_STATUSES) {
    for (const to of WORK_ITEM_STATUSES) {
      const expected = WORK_ITEM_TRANSITIONS.has(`${from}->${to}`);
      assertEquals(
        canTransitionWorkItem(from, to),
        expected,
        `${from} -> ${to}`,
      );
    }
  }
});

Deno.test("canTransitionStep covers every status pair", () => {
  for (const from of WORK_STEP_STATUSES) {
    for (const to of WORK_STEP_STATUSES) {
      const expected = STEP_TRANSITIONS.has(`${from}->${to}`);
      assertEquals(canTransitionStep(from, to), expected, `${from} -> ${to}`);
    }
  }
});

Deno.test("deriveReadySteps evaluates dependencies, wake times, retries, and ignores model suggestions", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const cases = [
    {
      name: "pending step with no dependencies is ready",
      steps: [buildStep({ id: "pending-ready" })],
      dependencies: [],
      expected: ["pending-ready"],
    },
    {
      name: "completed dependency unlocks pending successor",
      steps: [
        buildStep({ id: "done", status: "completed" }),
        buildStep({ id: "after-done" }),
      ],
      dependencies: [{
        predecessorStepId: "done",
        successorStepId: "after-done",
      }],
      expected: ["after-done"],
    },
    {
      name: "unfinished dependency keeps successor blocked",
      steps: [
        buildStep({ id: "still-running", status: "running" }),
        buildStep({ id: "after-running" }),
      ],
      dependencies: [{
        predecessorStepId: "still-running",
        successorStepId: "after-running",
      }],
      expected: [],
    },
    {
      name: "cancelled dependency never becomes ready by itself",
      steps: [
        buildStep({ id: "cancelled-parent", status: "cancelled" }),
        buildStep({ id: "child-after-cancel" }),
      ],
      dependencies: [{
        predecessorStepId: "cancelled-parent",
        successorStepId: "child-after-cancel",
      }],
      expected: [],
    },
    {
      name: "waiting step stays asleep before wakeAt",
      steps: [
        buildStep({
          id: "sleeping",
          status: "waiting",
          wakeAt: "2026-08-02T12:05:00.000Z",
        }),
      ],
      dependencies: [],
      expected: [],
    },
    {
      name: "waiting step wakes when wakeAt is reached",
      steps: [
        buildStep({
          id: "awake",
          status: "waiting",
          wakeAt: "2026-08-02T12:00:00.000Z",
        }),
      ],
      dependencies: [],
      expected: ["awake"],
    },
    {
      name: "retryable failed step below the ceiling is ready",
      steps: [
        buildStep({
          id: "retryable-failed",
          status: "failed",
          attemptCount: 1,
          maxAttempts: 3,
          lastErrorClass: "transient_provider",
        }),
      ],
      dependencies: [],
      expected: ["retryable-failed"],
    },
    {
      name: "retry ceiling prevents requeue",
      steps: [
        buildStep({
          id: "at-ceiling",
          status: "failed",
          attemptCount: 3,
          maxAttempts: 3,
          lastErrorClass: "transient_network",
        }),
      ],
      dependencies: [],
      expected: [],
    },
    {
      name: "non-retryable failure stays blocked",
      steps: [
        buildStep({
          id: "policy-failed",
          status: "failed",
          attemptCount: 1,
          maxAttempts: 3,
          lastErrorClass: "policy",
        }),
      ],
      dependencies: [],
      expected: [],
    },
    {
      name: "model suggestions cannot force readiness",
      steps: [
        buildStep({
          id: "isolated",
          status: "running",
          modelOutput: {
            status: "completed",
            dependencyOverrides: [],
            allowedTools: ["publish"],
            executionMode: "human",
          },
        } as unknown as Partial<WorkStepSnapshot>),
      ],
      dependencies: [],
      expected: [],
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      deriveReadySteps({
        steps: testCase.steps,
        dependencies: testCase.dependencies,
        now,
        authoritativeStateVersions: Object.fromEntries(
          testCase.steps.map((step) => [step.id, step.stateVersion]),
        ),
      }),
      testCase.expected,
      testCase.name,
    );
  }
});

Deno.test("deriveReadySteps fails closed across due, lease, and authoritative version states", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const cases: Array<{
    name: string;
    step: WorkStepSnapshot;
    authoritativeStateVersions: Record<string, number>;
    expected: string[];
  }> = [
    {
      name: "due unleased step with current version is ready",
      step: buildStep({
        id: "due-current",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:00.000Z",
        stateVersion: 4,
      }),
      authoritativeStateVersions: { "due-current": 4 },
      expected: ["due-current"],
    },
    {
      name: "future wake remains unavailable with current version",
      step: buildStep({
        id: "not-due",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:01.000Z",
        stateVersion: 4,
      }),
      authoritativeStateVersions: { "not-due": 4 },
      expected: [],
    },
    {
      name: "expired lease is available with current version",
      step: buildStep({
        id: "expired-current",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:00.000Z",
        stateVersion: 4,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-02T11:59:59.000Z",
      }),
      authoritativeStateVersions: { "expired-current": 4 },
      expected: ["expired-current"],
    },
    {
      name: "lease expiring exactly now is available with current version",
      step: buildStep({
        id: "expires-now",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:00.000Z",
        stateVersion: 4,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-02T12:00:00.000Z",
      }),
      authoritativeStateVersions: { "expires-now": 4 },
      expected: ["expires-now"],
    },
    {
      name: "active lease blocks readiness",
      step: buildStep({
        id: "leased-current",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:00.000Z",
        stateVersion: 4,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-02T12:00:01.000Z",
      }),
      authoritativeStateVersions: { "leased-current": 4 },
      expected: [],
    },
    {
      name: "partial lease fails closed",
      step: buildStep({
        id: "partial-lease",
        status: "waiting",
        wakeAt: "2026-08-02T12:00:00.000Z",
        stateVersion: 4,
        leaseOwner: "worker-a",
        leaseExpiresAt: null,
      }),
      authoritativeStateVersions: { "partial-lease": 4 },
      expected: [],
    },
    {
      name: "older snapshot version blocks readiness",
      step: buildStep({ id: "older-version", stateVersion: 3 }),
      authoritativeStateVersions: { "older-version": 4 },
      expected: [],
    },
    {
      name: "newer unexpected snapshot version blocks readiness",
      step: buildStep({ id: "newer-version", stateVersion: 5 }),
      authoritativeStateVersions: { "newer-version": 4 },
      expected: [],
    },
    {
      name: "missing authoritative version fails closed",
      step: buildStep({ id: "missing-version", stateVersion: 4 }),
      authoritativeStateVersions: {},
      expected: [],
    },
    {
      name: "expired lease cannot bypass stale version",
      step: buildStep({
        id: "expired-stale",
        stateVersion: 3,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-02T11:59:59.000Z",
      }),
      authoritativeStateVersions: { "expired-stale": 4 },
      expected: [],
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      deriveReadySteps({
        steps: [testCase.step],
        dependencies: [],
        now,
        authoritativeStateVersions: testCase.authoritativeStateVersions,
      }),
      testCase.expected,
      testCase.name,
    );
  }
});

Deno.test("deriveWorkItemStatus prevents false completion and respects terminal cancellation", () => {
  const cases = [
    { name: "empty work item stays queued", steps: [], expected: "queued" },
    {
      name: "running step makes item running",
      steps: [buildStep({ status: "running" })],
      expected: "running",
    },
    {
      name: "waiting step keeps item waiting",
      steps: [buildStep({ status: "waiting" })],
      expected: "waiting",
    },
    {
      name: "approval gate keeps item waiting",
      steps: [buildStep({ status: "needs_approval" })],
      expected: "waiting",
    },
    {
      name: "failed step makes item failed",
      steps: [buildStep({ status: "failed" })],
      expected: "failed",
    },
    {
      name: "pending step keeps item queued",
      steps: [buildStep({ status: "pending" })],
      expected: "queued",
    },
    {
      name: "ready step keeps item queued",
      steps: [buildStep({ status: "ready" })],
      expected: "queued",
    },
    {
      name: "all completed steps stop at needs_review",
      steps: [
        buildStep({ status: "completed" }),
        buildStep({ id: "done-2", status: "completed" }),
      ],
      expected: "needs_review",
    },
    {
      name: "completed and skipped still stop at needs_review",
      steps: [
        buildStep({ status: "completed" }),
        buildStep({ id: "skip-1", status: "skipped" }),
      ],
      expected: "needs_review",
    },
    {
      name: "cancelled branch keeps item cancelled",
      steps: [
        buildStep({ status: "completed" }),
        buildStep({ id: "cancel-1", status: "cancelled" }),
      ],
      expected: "cancelled",
    },
    {
      name: "mixed terminal and nonterminal states are not completed",
      steps: [
        buildStep({ status: "completed" }),
        buildStep({ id: "ready-1", status: "ready" }),
      ],
      expected: "queued",
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      deriveWorkItemStatus(testCase.steps),
      testCase.expected,
      testCase.name,
    );
  }

  for (
    const status of [
      "pending",
      "ready",
      "running",
      "waiting",
      "needs_approval",
      "failed",
      "cancelled",
    ] as const
  ) {
    assertEquals(
      deriveWorkItemStatus([buildStep({ status })]) === "completed",
      false,
      `single ${status} step must not derive completed`,
    );
  }
});

Deno.test("deriveCancellationPropagation cancels dependent active steps but preserves terminal immutability", () => {
  const steps = [
    buildStep({ id: "root", status: "cancelled" }),
    buildStep({ id: "child-1", status: "pending" }),
    buildStep({ id: "child-2", status: "waiting" }),
    buildStep({ id: "grandchild", status: "ready" }),
    buildStep({ id: "already-complete", status: "completed" }),
    buildStep({ id: "already-cancelled", status: "cancelled" }),
  ];

  const dependencies = [
    { predecessorStepId: "root", successorStepId: "child-1" },
    { predecessorStepId: "root", successorStepId: "child-2" },
    { predecessorStepId: "child-1", successorStepId: "grandchild" },
    { predecessorStepId: "root", successorStepId: "already-complete" },
    { predecessorStepId: "root", successorStepId: "already-cancelled" },
  ];

  assertEquals(
    deriveCancellationPropagation({
      steps,
      dependencies,
      cancelledStepIds: ["root"],
    }),
    ["child-1", "child-2", "grandchild"],
  );
});

Deno.test("canRetryStep respects server-owned error classes and retry ceilings", () => {
  const cases: Array<RetryDecisionInput & { expected: boolean }> = [
    {
      errorClass: "transient_provider",
      attemptCount: 0,
      maxAttempts: 3,
      expected: true,
    },
    {
      errorClass: "transient_network",
      attemptCount: 2,
      maxAttempts: 3,
      expected: true,
    },
    {
      errorClass: "lease_expired",
      attemptCount: 1,
      maxAttempts: 2,
      expected: true,
    },
    {
      errorClass: "transient_provider",
      attemptCount: 3,
      maxAttempts: 3,
      expected: false,
    },
    { errorClass: "policy", attemptCount: 0, maxAttempts: 3, expected: false },
    { errorClass: "tenant", attemptCount: 0, maxAttempts: 3, expected: false },
    {
      errorClass: "validation",
      attemptCount: 0,
      maxAttempts: 3,
      expected: false,
    },
    {
      errorClass: "stale_approval",
      attemptCount: 0,
      maxAttempts: 3,
      expected: false,
    },
    {
      errorClass: "forbidden_tool",
      attemptCount: 0,
      maxAttempts: 3,
      expected: false,
    },
    { errorClass: "unknown", attemptCount: 0, maxAttempts: 3, expected: false },
  ];

  for (const testCase of cases) {
    assertEquals(
      canRetryStep(testCase),
      testCase.expected,
      `${testCase.errorClass} @ ${testCase.attemptCount}/${testCase.maxAttempts}`,
    );
  }
});

Deno.test("evaluateLease fails closed for stale ownership and expiration", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const cases = [
    {
      name: "unleased step is available",
      input: {
        leaseOwner: null,
        leaseExpiresAt: null,
        workerId: "worker-a",
        now,
      },
      expected: "available",
    },
    {
      name: "fresh lease owned by caller is current",
      input: {
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-02T12:10:00.000Z",
        workerId: "worker-a",
        now,
      },
      expected: "held_by_worker",
    },
    {
      name: "fresh lease owned by another worker is blocked",
      input: {
        leaseOwner: "worker-b",
        leaseExpiresAt: "2026-08-02T12:10:00.000Z",
        workerId: "worker-a",
        now,
      },
      expected: "held_by_other",
    },
    {
      name: "expired lease is stale",
      input: {
        leaseOwner: "worker-b",
        leaseExpiresAt: "2026-08-02T11:59:59.000Z",
        workerId: "worker-a",
        now,
      },
      expected: "stale",
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      evaluateLease(testCase.input),
      testCase.expected,
      testCase.name,
    );
  }
});

Deno.test("evaluateStateVersion rejects stale snapshots", () => {
  assertEquals(
    evaluateStateVersion({ expectedStateVersion: 4, actualStateVersion: 4 }),
    "current",
  );
  assertEquals(
    evaluateStateVersion({ expectedStateVersion: 4, actualStateVersion: 5 }),
    "stale",
  );
  assertEquals(
    evaluateStateVersion({ expectedStateVersion: 4, actualStateVersion: 3 }),
    "stale",
  );
});

Deno.test("approval invalidation requires a current matching canonical hash", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const current: ApprovalHashInput = {
    workItemId: "work-1",
    stepId: "step-1",
    requiredRole: "bcba",
    executionMode: "model_suggested",
    inputHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64), "c".repeat(64)],
    completionCriteria: { stopAt: "needs_review" },
    dependencyKeys: ["validate_scope", "await_extraction"],
    toolAllowlist: ["review_snapshot"],
    workflowVersion: 1,
  };

  const approvalHash = canonicalApprovalHash(current);

  assertEquals(
    isApprovalCurrent({
      approvalStatus: "approved",
      approvalHash,
      currentApprovalHash: approvalHash,
      expiresAt: "2026-08-02T12:30:00.000Z",
      now,
    }),
    true,
  );

  assertEquals(
    isApprovalCurrent({
      approvalStatus: "approved",
      approvalHash,
      currentApprovalHash: canonicalApprovalHash({
        ...current,
        evidenceHashes: ["b".repeat(64), "d".repeat(64)],
      }),
      expiresAt: "2026-08-02T12:30:00.000Z",
      now,
    }),
    false,
  );

  assertEquals(
    isApprovalCurrent({
      approvalStatus: "revoked",
      approvalHash,
      currentApprovalHash: approvalHash,
      expiresAt: "2026-08-02T12:30:00.000Z",
      now,
    }),
    false,
  );

  assertEquals(
    isApprovalCurrent({
      approvalStatus: "approved",
      approvalHash,
      currentApprovalHash: approvalHash,
      expiresAt: "2026-08-02T11:59:59.000Z",
      now,
    }),
    false,
  );
});

Deno.test("canonicalApprovalHash is stable across field order and changes on semantic drift", () => {
  const left = canonicalApprovalHash({
    workItemId: "work-1",
    stepId: "step-1",
    requiredRole: "bcba",
    executionMode: "model_suggested",
    inputHash: "a".repeat(64),
    evidenceHashes: ["c".repeat(64), "b".repeat(64)],
    completionCriteria: {
      stopAt: "needs_review",
      severity: "clinical",
    },
    dependencyKeys: ["await_extraction", "validate_scope"],
    toolAllowlist: ["review_snapshot", "assign_owner"],
    workflowVersion: 1,
  });

  const reordered = canonicalApprovalHash({
    workflowVersion: 1,
    toolAllowlist: ["assign_owner", "review_snapshot"],
    dependencyKeys: ["validate_scope", "await_extraction"],
    completionCriteria: {
      severity: "clinical",
      stopAt: "needs_review",
    },
    evidenceHashes: ["b".repeat(64), "c".repeat(64)],
    inputHash: "a".repeat(64),
    executionMode: "model_suggested",
    requiredRole: "bcba",
    stepId: "step-1",
    workItemId: "work-1",
  });

  const drifted = canonicalApprovalHash({
    workItemId: "work-1",
    stepId: "step-1",
    requiredRole: "bcba",
    executionMode: "model_suggested",
    inputHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64), "c".repeat(64)],
    completionCriteria: {
      stopAt: "completed",
      severity: "clinical",
    },
    dependencyKeys: ["validate_scope", "await_extraction"],
    toolAllowlist: ["review_snapshot", "assign_owner"],
    workflowVersion: 1,
  });

  const orderedCriteria = canonicalApprovalHash({
    workItemId: "work-1",
    stepId: "step-1",
    requiredRole: "bcba",
    executionMode: "model_suggested",
    inputHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64), "c".repeat(64)],
    completionCriteria: {
      requiredSequence: ["validate", { action: "review", role: "bcba" }],
      stopAt: "needs_review",
    },
    dependencyKeys: ["validate_scope", "await_extraction"],
    toolAllowlist: ["review_snapshot", "assign_owner"],
    workflowVersion: 1,
  });

  const reorderedCriteriaKeys = canonicalApprovalHash({
    workflowVersion: 1,
    toolAllowlist: ["assign_owner", "review_snapshot"],
    dependencyKeys: ["await_extraction", "validate_scope"],
    completionCriteria: {
      stopAt: "needs_review",
      requiredSequence: ["validate", { role: "bcba", action: "review" }],
    },
    evidenceHashes: ["c".repeat(64), "b".repeat(64)],
    inputHash: "a".repeat(64),
    executionMode: "model_suggested",
    requiredRole: "bcba",
    stepId: "step-1",
    workItemId: "work-1",
  });

  const reorderedOrderedCriteria = canonicalApprovalHash({
    workItemId: "work-1",
    stepId: "step-1",
    requiredRole: "bcba",
    executionMode: "model_suggested",
    inputHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64), "c".repeat(64)],
    completionCriteria: {
      requiredSequence: [{ role: "bcba", action: "review" }, "validate"],
      stopAt: "needs_review",
    },
    dependencyKeys: ["validate_scope", "await_extraction"],
    toolAllowlist: ["review_snapshot", "assign_owner"],
    workflowVersion: 1,
  });

  assertEquals(left, reordered);
  assertEquals(left === drifted, false);
  assertEquals(orderedCriteria, reorderedCriteriaKeys);
  assertEquals(orderedCriteria === reorderedOrderedCriteria, false);
});

Deno.test("runtime model fields cannot override server-owned workflow authority", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const approvalInput: ApprovalHashInput = {
    workItemId: "work-authoritative",
    stepId: "step-authoritative",
    requiredRole: "bcba",
    executionMode: "deterministic",
    inputHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64)],
    completionCriteria: {
      requiredSequence: ["validate", "review"],
      stopAt: "needs_review",
    },
    dependencyKeys: ["validate_scope"],
    toolAllowlist: ["review_snapshot"],
    workflowVersion: 1,
  };
  const maliciousModelOutput = {
    tenantId: "tenant-attacker",
    organizationId: "org-attacker",
    scopeKey: "scope-attacker",
    workItemId: "work-attacker",
    stepId: "step-attacker",
    requiredRole: "attacker",
    approvalHash: "f".repeat(64),
    inputHash: "f".repeat(64),
    evidenceHashes: ["f".repeat(64)],
    executionMode: "human",
    completionCriteria: { stopAt: "completed", requiredSequence: ["publish"] },
    toolAllowlist: ["publish"],
    dependencyKeys: [],
    dependencies: [],
    status: "completed",
    maxAttempts: 999,
    lastErrorClass: "transient_provider",
    leaseOwner: null,
    leaseExpiresAt: null,
    stateVersion: 999,
    authoritativeStateVersions: { "step-authoritative": 999 },
  };

  const baselineReadyInput = {
    steps: [buildStep({ id: "step-authoritative", stateVersion: 4 })],
    dependencies: [{
      predecessorStepId: "missing",
      successorStepId: "step-authoritative",
    }],
    now,
    authoritativeStateVersions: { "step-authoritative": 4 },
  } satisfies DeriveReadyStepsInput;

  const cases = [
    {
      name:
        "tenant, scope, approval, execution, criteria, tools, and graph fields do not alter approval hashing",
      actual: canonicalApprovalHash(
        {
          ...approvalInput,
          modelOutput: maliciousModelOutput,
        } as ApprovalHashInput & { modelOutput: typeof maliciousModelOutput },
      ),
      expected: canonicalApprovalHash(approvalInput),
    },
    {
      name: "model dependency and state suggestions do not alter readiness",
      actual: deriveReadySteps(
        {
          ...baselineReadyInput,
          modelOutput: maliciousModelOutput,
          steps: [{
            ...baselineReadyInput.steps[0],
            modelOutput: maliciousModelOutput,
          }],
        } as unknown as typeof baselineReadyInput & {
          modelOutput: typeof maliciousModelOutput;
        },
      ),
      expected: [],
    },
    {
      name: "model retry ceiling and class do not alter retry authority",
      actual: canRetryStep(
        {
          errorClass: "policy",
          attemptCount: 3,
          maxAttempts: 3,
          modelOutput: maliciousModelOutput,
        } as RetryDecisionInput & { modelOutput: typeof maliciousModelOutput },
      ),
      expected: false,
    },
    {
      name: "model lease fields do not alter lease authority",
      actual: evaluateLease(
        {
          leaseOwner: "worker-authoritative",
          leaseExpiresAt: "2026-08-02T12:05:00.000Z",
          workerId: "worker-attacker",
          now,
          modelOutput: maliciousModelOutput,
        } as unknown as Parameters<typeof evaluateLease>[0],
      ),
      expected: "held_by_other",
    },
    {
      name: "model state version does not alter version authority",
      actual: evaluateStateVersion(
        {
          expectedStateVersion: 4,
          actualStateVersion: 3,
          modelOutput: maliciousModelOutput,
        } as unknown as Parameters<typeof evaluateStateVersion>[0],
      ),
      expected: "stale",
    },
    {
      name: "model completion status does not alter derived completion",
      actual: deriveWorkItemStatus([
        {
          ...buildStep({ status: "running" }),
          modelOutput: maliciousModelOutput,
        },
      ] as unknown as WorkStepSnapshot[]),
      expected: "running",
    },
  ];

  for (const testCase of cases) {
    assertEquals(testCase.actual, testCase.expected, testCase.name);
  }
});
