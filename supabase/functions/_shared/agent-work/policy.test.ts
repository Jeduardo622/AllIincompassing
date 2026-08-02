type AssertionError = Error & { name: "AssertionError" };

function fail(message: string): never {
  const error = new Error(message) as AssertionError;
  error.name = "AssertionError";
  throw error;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    fail(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDecision(
  decision: { allowed: boolean; reasonCode: string },
  expectedAllowed: boolean,
  expectedReasonCode: string,
  name: string,
): void {
  assertEquals(decision.allowed, expectedAllowed, `${name}: allowed`);
  assertEquals(decision.reasonCode, expectedReasonCode, `${name}: reasonCode`);
}

import {
  authorizeWorkAction,
  type AgentWorkActor,
  type AgentWorkAction,
  type AgentWorkRuntimeMode,
  type AgentWorkScope,
  type WorkflowDefinition,
} from "./policy.ts";

const BASE_WORKFLOW: WorkflowDefinition = {
  workflow: "assessment.iehp.prepare_for_clinical_review@1",
  version: 1,
  actions: {
    claim_step: {
      allowedRuntimeModes: ["shadow", "active"],
      requiredRoles: ["admin", "bcba"],
      allowedTools: ["claim_step"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
    transition_step: {
      allowedRuntimeModes: ["shadow", "advisory", "active"],
      requiredRoles: ["admin", "bcba"],
      allowedTools: ["review_snapshot", "record_projection"],
      clinicalEffect: false,
      requiresCurrentApproval: true,
    },
    record_projection: {
      allowedRuntimeModes: ["shadow", "advisory", "active"],
      requiredRoles: ["admin", "bcba", "system_service"],
      allowedTools: ["record_projection"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
  },
};

function buildActor(overrides: Partial<AgentWorkActor> = {}): AgentWorkActor {
  return {
    actorId: "11111111-1111-4111-8111-111111111111",
    actorKind: "human_user",
    orgRoleBindings: [{
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "bcba",
      active: true,
      expiresAt: null,
    }],
    ...overrides,
  };
}

function buildScope(overrides: Partial<AgentWorkScope> = {}): AgentWorkScope {
  return {
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    stepId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    validation: {
      verdict: "in_scope",
      source: "repository",
      authoritative: true,
      validatedOrganizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      validatedClientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
    ...overrides,
  };
}

function buildAction(overrides: Partial<AgentWorkAction> = {}): AgentWorkAction {
  return {
    action: "transition_step",
    workflow: "assessment.iehp.prepare_for_clinical_review@1",
    tool: "review_snapshot",
    approval: {
      status: "approved",
      approvalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedApprovalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      evidenceHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expectedEvidenceHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expiresAt: "2026-08-02T13:00:00.000Z",
    },
    clinicalEffect: false,
    now: new Date("2026-08-02T12:00:00.000Z"),
    ...overrides,
  };
}

function authorize(input: {
  actor?: AgentWorkActor | null;
  scope?: AgentWorkScope | null;
  action?: AgentWorkAction;
  runtimeMode?: AgentWorkRuntimeMode | null;
  workflow?: WorkflowDefinition;
  killSwitchEnabled?: boolean;
} = {}) {
  return authorizeWorkAction({
    actor: "actor" in input ? input.actor ?? null : buildActor(),
    scope: "scope" in input ? input.scope ?? null : buildScope(),
    action: input.action ?? buildAction(),
    runtimeMode: "runtimeMode" in input ? input.runtimeMode ?? null : "active",
    workflow: input.workflow ?? BASE_WORKFLOW,
    killSwitchEnabled: input.killSwitchEnabled ?? false,
  });
}

Deno.test("authorizeWorkAction fails closed for missing runtime mode and kill switch", () => {
  assertDecision(
    authorize({ runtimeMode: null }),
    false,
    "runtime_mode_unavailable",
    "null runtime mode",
  );

  assertDecision(
    authorize({ killSwitchEnabled: true }),
    false,
    "runtime_kill_switch_enabled",
    "kill switch",
  );
});

Deno.test("authorizeWorkAction denies missing actor, unknown workflows, and unknown tools", () => {
  assertDecision(
    authorize({ actor: null }),
    false,
    "actor_required",
    "missing actor",
  );

  assertDecision(
    authorize({
      action: buildAction({ workflow: "assessment.unknown@1" }),
    }),
    false,
    "unknown_workflow",
    "unknown workflow",
  );

  assertDecision(
    authorize({
      action: buildAction({ tool: "publish_clinical_record" }),
    }),
    false,
    "forbidden_tool",
    "forbidden tool",
  );
});

Deno.test("authorizeWorkAction rejects org/client mismatch and inactive membership", () => {
  assertDecision(
    authorize({
      scope: buildScope({
        validation: {
          verdict: "wrong_client",
          source: "repository",
          authoritative: true,
          validatedOrganizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          validatedClientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        },
      }),
    }),
    false,
    "scope_mismatch",
    "scope verdict mismatch",
  );

  assertDecision(
    authorize({
      actor: buildActor({
        orgRoleBindings: [{
          organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "bcba",
          active: false,
          expiresAt: null,
        }],
      }),
    }),
    false,
    "inactive_membership",
    "inactive membership",
  );
});

Deno.test("authorizeWorkAction rejects insufficient role and stale approvals", () => {
  assertDecision(
    authorize({
      actor: buildActor({
        orgRoleBindings: [{
          organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "bt",
          active: true,
          expiresAt: null,
        }],
      }),
    }),
    false,
    "insufficient_role",
    "insufficient role",
  );

  assertDecision(
    authorize({
      action: buildAction({
        approval: {
          status: "approved",
          approvalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          expectedApprovalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          evidenceHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          expectedEvidenceHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          expiresAt: "2026-08-02T11:59:59.000Z",
        },
      }),
    }),
    false,
    "stale_approval",
    "expired approval",
  );

  assertDecision(
    authorize({
      action: buildAction({
        approval: {
          status: "approved",
          approvalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          expectedApprovalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          evidenceHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          expectedEvidenceHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          expiresAt: "2026-08-02T13:00:00.000Z",
        },
      }),
    }),
    false,
    "stale_evidence_hash",
    "changed evidence hash",
  );
});

Deno.test("authorizeWorkAction enforces runtime mode semantics and blocks clinical effects", () => {
  assertDecision(
    authorize({
      runtimeMode: "disabled",
      action: buildAction({ action: "record_projection", tool: "record_projection", approval: null }),
    }),
    false,
    "runtime_mode_disabled",
    "disabled mode",
  );

  const shadowDecision = authorize({
    runtimeMode: "shadow",
    action: buildAction({ action: "record_projection", tool: "record_projection", approval: null }),
  });
  assertDecision(shadowDecision, true, "allowed", "shadow projection");
  assertEquals(shadowDecision.runtimeMode, "shadow", "shadow runtime mode preserved");

  const advisoryDecision = authorize({
    runtimeMode: "advisory",
    action: buildAction({ action: "record_projection", tool: "record_projection", approval: null }),
  });
  assertDecision(advisoryDecision, true, "allowed", "advisory projection");

  assertDecision(
    authorize({
      runtimeMode: "active",
      action: buildAction({ clinicalEffect: true }),
    }),
    false,
    "clinical_effects_forbidden",
    "active still blocks clinical effects",
  );
});

Deno.test("authorizeWorkAction accepts explicit active mutation only when workflow-owned and fully current", () => {
  const decision = authorize();

  assertDecision(decision, true, "allowed", "active happy path");
  assert(decision.allowedTool === "review_snapshot", "expected allowed tool to echo the workflow-owned tool");
  assertEquals(decision.runtimeMode, "active", "runtime mode");
});
