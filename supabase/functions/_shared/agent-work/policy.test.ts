type AssertionError = Error & { name: "AssertionError" };

function fail(message: string): never {
  const error = new Error(message) as AssertionError;
  error.name = "AssertionError";
  throw error;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

import {
  type AgentWorkAction,
  type AgentWorkActor,
  type AgentWorkApprovalContext,
  type AgentWorkRuntimeMode,
  type AgentWorkScope,
  type AgentWorkScopeValidation,
  authorizeWorkAction,
  type WorkflowDefinition,
} from "./policy.ts";
import {
  type AgentWorkAuthorityContext,
  type AgentWorkAuthorityLoader,
  type AgentWorkEventRow,
  AgentWorkRepository,
  type AgentWorkRepositoryClient,
  type AgentWorkRpcResponse,
  type ClaimStepInput,
  type TransitionStepInput,
} from "./repository.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORK_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STEP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTEMPT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const APPROVAL_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "99999999-9999-4999-8999-999999999999";
const APPROVAL_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EVIDENCE_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-08-02T12:00:00.000Z");

const BASE_WORKFLOW: WorkflowDefinition = {
  workflow: "assessment.iehp.prepare_for_clinical_review@1",
  version: 1,
  actions: {
    claim_step: {
      allowedRuntimeModes: ["active"],
      requiredRoles: ["worker"],
      allowedTools: ["claim_step"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
    transition_step: {
      allowedRuntimeModes: ["active"],
      requiredRoles: ["worker"],
      allowedTools: ["review_snapshot"],
      clinicalEffect: false,
      requiresCurrentApproval: true,
    },
    record_projection: {
      allowedRuntimeModes: ["shadow", "advisory", "active"],
      requiredRoles: ["worker"],
      allowedTools: ["record_projection"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
  },
};

const CURRENT_APPROVAL: AgentWorkApprovalContext = {
  status: "approved",
  approvalHash: APPROVAL_HASH,
  expectedApprovalHash: APPROVAL_HASH,
  evidenceHash: EVIDENCE_HASH,
  expectedEvidenceHash: EVIDENCE_HASH,
  expiresAt: "2026-08-02T13:00:00.000Z",
};

function buildActor(overrides: Partial<AgentWorkActor> = {}): AgentWorkActor {
  return {
    id: ACTOR_ID,
    kind: "worker",
    currentOrgRoles: [{
      organizationId: ORGANIZATION_ID,
      role: "worker",
      active: true,
      expiresAt: null,
    }],
    ...overrides,
  };
}

function buildScope(overrides: Partial<AgentWorkScope> = {}): AgentWorkScope {
  return {
    organizationId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    ...overrides,
  };
}

function buildValidation(
  overrides: Partial<AgentWorkScopeValidation> = {},
): AgentWorkScopeValidation {
  return {
    verdict: "in_scope",
    source: "authority_loader",
    authoritative: true,
    validatedOrganizationId: ORGANIZATION_ID,
    validatedClientId: CLIENT_ID,
    validatedWorkItemId: WORK_ITEM_ID,
    validatedStepId: STEP_ID,
    ...overrides,
  };
}

function buildAction(
  overrides: Partial<AgentWorkAction> = {},
): AgentWorkAction {
  return {
    action: "transition_step",
    workflow: BASE_WORKFLOW.workflow,
    tool: "review_snapshot",
    approval: CURRENT_APPROVAL,
    clinicalEffect: false,
    now: NOW,
    ...overrides,
  };
}

function authorize(input: {
  actor?: AgentWorkActor | null;
  scope?: AgentWorkScope | null;
  scopeValidation?: AgentWorkScopeValidation | null;
  action?: AgentWorkAction;
  runtimeMode?: AgentWorkRuntimeMode | null;
  workflow?: WorkflowDefinition;
  killSwitchEnabled?: boolean;
} = {}) {
  return authorizeWorkAction({
    actor: "actor" in input ? input.actor ?? null : buildActor(),
    scope: "scope" in input ? input.scope ?? null : buildScope(),
    scopeValidation: "scopeValidation" in input
      ? input.scopeValidation ?? null
      : buildValidation(),
    action: input.action ?? buildAction(),
    runtimeMode: "runtimeMode" in input ? input.runtimeMode ?? null : "active",
    workflow: input.workflow ?? BASE_WORKFLOW,
    killSwitchEnabled: input.killSwitchEnabled ?? false,
  });
}

Deno.test("authorizeWorkAction fails closed for authority, membership, approval, and runtime failures", () => {
  const cases: Array<[string, ReturnType<typeof authorize>, string]> = [
    ["missing actor", authorize({ actor: null }), "actor_required"],
    [
      "missing runtime",
      authorize({ runtimeMode: null }),
      "runtime_mode_unavailable",
    ],
    [
      "kill switch",
      authorize({ killSwitchEnabled: true }),
      "runtime_kill_switch_enabled",
    ],
    [
      "scope mismatch",
      authorize({
        scopeValidation: buildValidation({ validatedWorkItemId: APPROVAL_ID }),
      }),
      "scope_mismatch",
    ],
    [
      "inactive membership",
      authorize({
        actor: buildActor({
          currentOrgRoles: [{
            organizationId: ORGANIZATION_ID,
            role: "worker",
            active: false,
            expiresAt: null,
          }],
        }),
      }),
      "inactive_membership",
    ],
    [
      "insufficient role",
      authorize({
        actor: buildActor({
          currentOrgRoles: [{
            organizationId: ORGANIZATION_ID,
            role: "observer",
            active: true,
            expiresAt: null,
          }],
        }),
      }),
      "insufficient_role",
    ],
    [
      "unknown workflow",
      authorize({
        action: buildAction({ workflow: "assessment.unknown@1" }),
      }),
      "unknown_workflow",
    ],
    [
      "forbidden tool",
      authorize({
        action: buildAction({ tool: "publish_clinical_record" }),
      }),
      "forbidden_tool",
    ],
    [
      "expired approval",
      authorize({
        action: buildAction({
          approval: {
            ...CURRENT_APPROVAL,
            expiresAt: "2026-08-02T11:59:59.000Z",
          },
        }),
      }),
      "stale_approval",
    ],
    [
      "changed evidence",
      authorize({
        action: buildAction({
          approval: {
            ...CURRENT_APPROVAL,
            evidenceHash:
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          },
        }),
      }),
      "stale_evidence_hash",
    ],
  ];

  for (const [name, decision, reasonCode] of cases) {
    assertEquals(decision.allowed, false, `${name}: allowed`);
    assertEquals(decision.reasonCode, reasonCode, `${name}: reason`);
  }
});

Deno.test("authorizeWorkAction preserves mode semantics and forbids clinical effects", () => {
  assertEquals(
    authorize({ runtimeMode: "disabled" }).reasonCode,
    "runtime_mode_disabled",
  );
  assertEquals(
    authorize({ runtimeMode: "shadow" }).reasonCode,
    "shadow_mode_projection_only",
  );
  assertEquals(
    authorize({ runtimeMode: "advisory" }).reasonCode,
    "advisory_mode_projection_only",
  );
  assertEquals(
    authorize({ action: buildAction({ clinicalEffect: true }) }).reasonCode,
    "clinical_effects_forbidden",
  );

  const projection = authorize({
    runtimeMode: "shadow",
    action: buildAction({
      action: "record_projection",
      tool: "record_projection",
      approval: null,
    }),
  });
  assertEquals(projection.allowed, true);
});

function buildAdvisoryWorkflow(): WorkflowDefinition {
  return {
    ...BASE_WORKFLOW,
    actions: {
      ...BASE_WORKFLOW.actions,
      claim_step: {
        ...BASE_WORKFLOW.actions.claim_step,
        allowedRuntimeModes: ["advisory", "active"],
      },
      transition_step: {
        ...BASE_WORKFLOW.actions.transition_step,
        allowedRuntimeModes: ["advisory", "active"],
      },
    },
  };
}

Deno.test("authorizeWorkAction allows advisory claim_step when the server-owned workflow action explicitly permits it", () => {
  const decision = authorize({
    runtimeMode: "advisory",
    workflow: buildAdvisoryWorkflow(),
    action: buildAction({
      action: "claim_step",
      tool: "claim_step",
      approval: null,
    }),
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.reasonCode, "allowed");
  assertEquals(decision.allowedTool, "claim_step");
});

Deno.test("authorizeWorkAction allows advisory transition_step when the server-owned workflow action explicitly permits it", () => {
  const decision = authorize({
    runtimeMode: "advisory",
    workflow: buildAdvisoryWorkflow(),
    action: buildAction(),
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.reasonCode, "allowed");
  assertEquals(decision.allowedTool, "review_snapshot");
});

Deno.test("authorizeWorkAction keeps advisory fail-closed for shadow, clinical-effect, and unavailable policy cases", () => {
  const advisoryWorkflow = buildAdvisoryWorkflow();

  assertEquals(
    authorize({
      runtimeMode: "shadow",
      workflow: advisoryWorkflow,
      action: buildAction({
        action: "claim_step",
        tool: "claim_step",
        approval: null,
      }),
    }).reasonCode,
    "shadow_mode_projection_only",
  );
  assertEquals(
    authorize({
      runtimeMode: "advisory",
      workflow: advisoryWorkflow,
      action: buildAction({
        action: "claim_step",
        tool: "claim_step",
        approval: null,
        clinicalEffect: true,
      }),
    }).reasonCode,
    "clinical_effects_forbidden",
  );
  assertEquals(
    authorize({
      runtimeMode: null,
      workflow: advisoryWorkflow,
      action: buildAction({
        action: "claim_step",
        tool: "claim_step",
        approval: null,
      }),
    }).reasonCode,
    "runtime_mode_unavailable",
  );
});

Deno.test("authorizeWorkAction rejects advisory claim_step for a human/user actor path via role and actor constraints", () => {
  const decision = authorize({
    runtimeMode: "advisory",
    workflow: buildAdvisoryWorkflow(),
    actor: buildActor({
      kind: "user",
      currentOrgRoles: [{
        organizationId: ORGANIZATION_ID,
        role: "observer",
        active: true,
        expiresAt: null,
      }],
    }),
    action: buildAction({
      action: "claim_step",
      tool: "claim_step",
      approval: null,
    }),
  });

  assertEquals(decision.allowed, false);
  assertEquals(decision.reasonCode, "insufficient_role");
});

Deno.test("authorizeWorkAction keeps advisory unavailable to claim_step when the server-owned tool is not allowed", () => {
  const decision = authorize({
    runtimeMode: "advisory",
    workflow: buildAdvisoryWorkflow(),
    action: buildAction({
      action: "claim_step",
      tool: "review_snapshot",
      approval: null,
    }),
  });

  assertEquals(decision.allowed, false);
  assertEquals(decision.reasonCode, "forbidden_tool");
});

function buildAuthority(
  overrides: Partial<AgentWorkAuthorityContext> = {},
): AgentWorkAuthorityContext {
  return {
    runtimeMode: "active",
    killSwitchEnabled: false,
    workflow: BASE_WORKFLOW,
    action: "transition_step",
    tool: "review_snapshot",
    approval: CURRENT_APPROVAL,
    recordBinding: {
      organizationId: ORGANIZATION_ID,
      clientId: CLIENT_ID,
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      attemptId: ATTEMPT_ID,
    },
    allowedMachineValues: {
      workflows: [
        BASE_WORKFLOW.workflow,
        "assessment.iehp.prepare_for_clinical_review",
      ],
      workflowVersions: [1],
      tools: ["claim_step", "review_snapshot", "record_projection"],
      reasonCodes: ["step_completed", "approval_current"],
      resultCodes: ["projection_recorded"],
      statuses: ["waiting", "completed"],
      workerIds: [ACTOR_ID],
    },
    ...overrides,
  };
}

class FakeClient implements AgentWorkRepositoryClient {
  rpcCalls: Array<{ fn: string; params: Readonly<Record<string, unknown>> }> =
    [];
  listCalls: Array<{ workItemId: string; limit: number }> = [];
  rpcResponse: AgentWorkRpcResponse<unknown> = {
    data: { id: STEP_ID },
    error: null,
  };
  eventResponse: AgentWorkRpcResponse<ReadonlyArray<AgentWorkEventRow>> = {
    data: [],
    error: null,
  };

  rpc<TResult>(
    fn: "claim_agent_work_step" | "transition_agent_work_step",
    params: Readonly<Record<string, unknown>>,
  ): Promise<AgentWorkRpcResponse<TResult>> {
    this.rpcCalls.push({ fn, params });
    return Promise.resolve(this.rpcResponse as AgentWorkRpcResponse<TResult>);
  }

  listEvents(input: { workItemId: string; limit: number }) {
    this.listCalls.push(input);
    return Promise.resolve(this.eventResponse);
  }
}

class FakeAuthorityLoader implements AgentWorkAuthorityLoader {
  calls: unknown[] = [];
  context: AgentWorkAuthorityContext | null = buildAuthority();
  error: Error | null = null;

  loadAuthority(input: unknown): Promise<AgentWorkAuthorityContext | null> {
    this.calls.push(input);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.context);
  }
}

function createRepository() {
  const client = new FakeClient();
  const loader = new FakeAuthorityLoader();
  const repository = new AgentWorkRepository(client, loader, () => NOW);
  return { client, loader, repository };
}

function transitionInput(): TransitionStepInput {
  return {
    actor: buildActor(),
    scope: buildScope(),
    expectedStateVersion: 3,
    toStatus: "completed",
    reasonCode: "step_completed",
    outputHash: APPROVAL_HASH,
    metadata: {
      result_code: "projection_recorded",
      evidence_hash: EVIDENCE_HASH,
      duration_ms: 1200,
      retry_count: 2,
    },
  };
}

Deno.test("repository fails closed before RPC for missing actor or scope", async () => {
  for (
    const [name, input, reason] of [
      ["actor", { ...transitionInput(), actor: null }, "actor_required"],
      ["scope", { ...transitionInput(), scope: null }, "scope_required"],
    ] as const
  ) {
    const { client, loader, repository } = createRepository();
    const result = await repository.transitionStep(
      input as unknown as TransitionStepInput,
    );
    assertEquals(result, { ok: false, reasonCode: reason }, name);
    assertEquals(loader.calls.length, 0, `${name}: authority calls`);
    assertEquals(client.rpcCalls.length, 0, `${name}: rpc calls`);
  }
});

Deno.test("repository fails closed on authority error, null, or exact record binding mismatch", async () => {
  const cases: Array<[string, (loader: FakeAuthorityLoader) => void, string]> =
    [
      [
        "lookup error",
        (loader) => loader.error = new Error("unreadable"),
        "authority_lookup_failed",
      ],
      [
        "lookup null",
        (loader) => loader.context = null,
        "authority_context_unavailable",
      ],
      ["organization mismatch", (loader) =>
        loader.context = buildAuthority({
          recordBinding: {
            ...buildAuthority().recordBinding,
            organizationId: APPROVAL_ID,
          },
        }), "authority_scope_mismatch"],
      ["work item mismatch", (loader) =>
        loader.context = buildAuthority({
          recordBinding: {
            ...buildAuthority().recordBinding,
            workItemId: APPROVAL_ID,
          },
        }), "authority_scope_mismatch"],
      ["step mismatch", (loader) =>
        loader.context = buildAuthority({
          recordBinding: {
            ...buildAuthority().recordBinding,
            stepId: APPROVAL_ID,
          },
        }), "authority_scope_mismatch"],
    ];

  for (const [name, configure, reasonCode] of cases) {
    const { client, loader, repository } = createRepository();
    configure(loader);
    const result = await repository.transitionStep(transitionInput());
    assertEquals(result, { ok: false, reasonCode }, name);
    assertEquals(client.rpcCalls.length, 0, `${name}: rpc calls`);
  }
});

Deno.test("repository enforces loader-owned runtime, workflow, action, tool, approval, and status authority", async () => {
  const cases: Array<
    [string, Partial<AgentWorkAuthorityContext>, string]
  > = [
    ["runtime", { runtimeMode: null }, "runtime_mode_unavailable"],
    [
      "workflow",
      {
        allowedMachineValues: {
          ...buildAuthority().allowedMachineValues,
          workflows: [],
        },
      },
      "authority_context_invalid",
    ],
    ["action", { action: "claim_step" }, "authority_action_mismatch"],
    [
      "tool",
      {
        allowedMachineValues: {
          ...buildAuthority().allowedMachineValues,
          tools: [],
        },
      },
      "forbidden_tool",
    ],
    [
      "approval",
      {
        approval: {
          ...CURRENT_APPROVAL,
          expiresAt: "2026-08-02T11:59:59.000Z",
        },
      },
      "stale_approval",
    ],
    [
      "status",
      {
        allowedMachineValues: {
          ...buildAuthority().allowedMachineValues,
          statuses: [],
        },
      },
      "machine_value_not_allowed",
    ],
  ];

  for (const [name, override, reasonCode] of cases) {
    const { client, loader, repository } = createRepository();
    loader.context = buildAuthority(override);
    const result = await repository.transitionStep(transitionInput());
    assertEquals(result, { ok: false, reasonCode }, name);
    assertEquals(client.rpcCalls.length, 0, `${name}: rpc calls`);
  }
});

Deno.test("repository API rejects caller workflow, approval, tool, allowed sets, and scope verdicts", async () => {
  const maliciousValues: Array<[string, Record<string, unknown>]> = [
    ["runtime mode", { runtimeMode: "active" }],
    ["workflow", { workflow: BASE_WORKFLOW }],
    ["action", { action: "transition_step" }],
    ["approval", { approval: CURRENT_APPROVAL }],
    ["tool", { tool: "review_snapshot" }],
    ["allowed values", { allowedMachineValues: { reasonCodes: ["jane"] } }],
  ];

  for (const [name, extra] of maliciousValues) {
    const { client, loader, repository } = createRepository();
    const result = await repository.transitionStep({
      ...transitionInput(),
      ...extra,
    } as unknown as TransitionStepInput);
    assertEquals(result, {
      ok: false,
      reasonCode: "repository_input_key_forbidden",
    }, name);
    assertEquals(loader.calls.length, 0, `${name}: authority calls`);
    assertEquals(client.rpcCalls.length, 0, `${name}: rpc calls`);
  }

  const { client, loader, repository } = createRepository();
  const result = await repository.transitionStep({
    ...transitionInput(),
    scope: {
      ...buildScope(),
      validation: { authoritative: true, verdict: "in_scope" },
    },
  } as unknown as TransitionStepInput);
  assertEquals(result, {
    ok: false,
    reasonCode: "repository_input_key_forbidden",
  });
  assertEquals(loader.calls.length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("claim requires worker actor and sends exact actor-derived RPC payload", async () => {
  const input: ClaimStepInput = {
    actor: buildActor(),
    scope: buildScope({ stepId: null }),
    leaseSeconds: 60,
  };

  const denied = createRepository();
  denied.loader.context = buildAuthority({
    action: "claim_step",
    tool: "claim_step",
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      stepId: null,
      attemptId: null,
    },
  });
  const deniedResult = await denied.repository.claimStep({
    ...input,
    actor: buildActor({ kind: "service_role" }),
  });
  assertEquals(deniedResult, {
    ok: false,
    reasonCode: "claim_actor_kind_forbidden",
  });
  assertEquals(denied.client.rpcCalls.length, 0);

  const allowed = createRepository();
  allowed.loader.context = buildAuthority({
    action: "claim_step",
    tool: "claim_step",
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      stepId: null,
      attemptId: null,
    },
  });
  const result = await allowed.repository.claimStep(input);
  assertEquals(result.ok, true);
  assertEquals(allowed.client.rpcCalls, [{
    fn: "claim_agent_work_step",
    params: {
      p_work_item_id: WORK_ITEM_ID,
      p_worker_id: ACTOR_ID,
      p_lease_seconds: 60,
    },
  }]);
});

Deno.test("claim rejects fabricated work item binding before RPC", async () => {
  const { client, loader, repository } = createRepository();
  loader.context = buildAuthority({
    action: "claim_step",
    tool: "claim_step",
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      workItemId: APPROVAL_ID,
      stepId: null,
      attemptId: null,
    },
  });

  const result = await repository.claimStep({
    actor: buildActor(),
    scope: buildScope({ stepId: null }),
    leaseSeconds: 60,
  });
  assertEquals(result, { ok: false, reasonCode: "authority_scope_mismatch" });
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("transition selects authority tool and sends exact Task 2 RPC payload", async () => {
  const { client, loader, repository } = createRepository();
  const result = await repository.transitionStep(transitionInput());

  assertEquals(result.ok, true);
  assertEquals(loader.calls, [{
    actor: buildActor(),
    scope: buildScope(),
    operation: "transition_step",
    now: NOW,
  }]);
  assertEquals(client.rpcCalls, [{
    fn: "transition_agent_work_step",
    params: {
      p_step_id: STEP_ID,
      p_expected_state_version: 3,
      p_to_status: "completed",
      p_reason_code: "step_completed",
      p_output_hash: APPROVAL_HASH,
      p_sanitized_metadata: {
        worker_id: ACTOR_ID,
        attempt_id: ATTEMPT_ID,
        result_code: "projection_recorded",
        evidence_hash: EVIDENCE_HASH,
        duration_ms: 1200,
        retry_count: 2,
      },
    },
  }]);
});

Deno.test("repository rejects caller metadata tool and closed-set short names", async () => {
  for (
    const [name, metadata, reasonCode] of [
      ["tool", { tool: "review_snapshot" }, "event_metadata_key_forbidden"],
      ["short result", { result_code: "jane" }, "machine_value_not_allowed"],
      [
        "narrative result",
        { result_code: "jane needs help" },
        "event_metadata_value_forbidden",
      ],
    ] as const
  ) {
    const { client, repository } = createRepository();
    const result = await repository.transitionStep({
      ...transitionInput(),
      metadata,
    } as TransitionStepInput);
    assertEquals(result, { ok: false, reasonCode }, name);
    assertEquals(client.rpcCalls.length, 0, `${name}: rpc calls`);
  }

  const { client, repository } = createRepository();
  const reasonResult = await repository.transitionStep({
    ...transitionInput(),
    reasonCode: "jane",
  });
  assertEquals(reasonResult, {
    ok: false,
    reasonCode: "machine_value_not_allowed",
  });
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("listEvents validates real claim and transition rows without rewriting them", async () => {
  const claimRow: AgentWorkEventRow = {
    id: "12121212-1212-4121-8121-121212121212",
    work_item_id: WORK_ITEM_ID,
    step_id: STEP_ID,
    attempt_id: ATTEMPT_ID,
    organization_id: ORGANIZATION_ID,
    client_id: CLIENT_ID,
    event_type: "step.claimed",
    actor_kind: "worker",
    actor_id: ACTOR_ID,
    sanitized_metadata: { lease_seconds: 60, attempt_number: 1 },
    created_at: "2026-08-02T12:00:00.000Z",
  };
  const transitionRow: AgentWorkEventRow = {
    ...claimRow,
    id: "13131313-1313-4131-8131-131313131313",
    event_type: "step.transitioned",
    sanitized_metadata: {
      worker_id: ACTOR_ID,
      attempt_id: ATTEMPT_ID,
      result_code: "projection_recorded",
      evidence_hash: EVIDENCE_HASH,
      duration_ms: 1200,
      retry_count: 2,
      approval_id: APPROVAL_ID,
      to_status: "completed",
      reason_code: "step_completed",
    },
  };
  const rows = [claimRow, transitionRow] as const;
  const { client, loader, repository } = createRepository();
  loader.context = buildAuthority({
    action: null,
    tool: null,
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      stepId: null,
      attemptId: null,
    },
  });
  client.eventResponse = { data: rows, error: null };

  const result = await repository.listEvents({
    actor: buildActor(),
    scope: buildScope({ stepId: null }),
    limit: 25,
  });
  assert(result.ok, "expected event read success");
  assert(result.data === rows, "stored rows must not be cloned or rewritten");
  assertEquals(client.listCalls, [{ workItemId: WORK_ITEM_ID, limit: 25 }]);
});

Deno.test("listEvents rejects SQL-shaped rows with closed-set short-name tokens", async () => {
  const { client, loader, repository } = createRepository();
  loader.context = buildAuthority({
    action: null,
    tool: null,
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      stepId: null,
      attemptId: null,
    },
  });
  client.eventResponse = {
    data: [{
      id: "12121212-1212-4121-8121-121212121212",
      work_item_id: WORK_ITEM_ID,
      step_id: STEP_ID,
      attempt_id: ATTEMPT_ID,
      organization_id: ORGANIZATION_ID,
      client_id: CLIENT_ID,
      event_type: "step.transitioned",
      actor_kind: "worker",
      actor_id: ACTOR_ID,
      sanitized_metadata: { to_status: "completed", reason_code: "jane" },
      created_at: "2026-08-02T12:00:00.000Z",
    }],
    error: null,
  };

  const result = await repository.listEvents({
    actor: buildActor(),
    scope: buildScope({ stepId: null }),
  });
  assertEquals(result, { ok: false, reasonCode: "machine_value_not_allowed" });
});

Deno.test("stored workflow creation metadata is accepted only from authority closed sets", async () => {
  const { client, loader, repository } = createRepository();
  loader.context = buildAuthority({
    action: null,
    tool: null,
    approval: null,
    recordBinding: {
      ...buildAuthority().recordBinding,
      stepId: null,
      attemptId: null,
    },
  });
  const row: AgentWorkEventRow = {
    id: "12121212-1212-4121-8121-121212121212",
    work_item_id: WORK_ITEM_ID,
    step_id: null,
    attempt_id: null,
    organization_id: ORGANIZATION_ID,
    client_id: CLIENT_ID,
    event_type: "work_item.created",
    actor_kind: "user",
    actor_id: ACTOR_ID,
    sanitized_metadata: {
      workflow_key: "assessment.iehp.prepare_for_clinical_review",
      workflow_version: 1,
      assessment_document_id: DOCUMENT_ID,
    },
    created_at: "2026-08-02T12:00:00.000Z",
  };
  client.eventResponse = { data: [row], error: null };

  const result = await repository.listEvents({
    actor: buildActor(),
    scope: buildScope({ stepId: null }),
  });
  assertEquals(result.ok, true);
});
