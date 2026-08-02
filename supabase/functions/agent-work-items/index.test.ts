import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  type AgentWorkItemApprovalView,
  type AgentWorkItemBlockerView,
  type AgentWorkItemStepView,
  type AgentWorkItemView,
  AgentWorkRequestError,
  createAgentWorkItemsHandler,
} from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const ASSESSMENT_DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const WORK_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const STEP_ID = "66666666-6666-4666-8666-666666666666";
const APPROVAL_ID = "77777777-7777-4777-8777-777777777777";

function createStep(
  overrides: Partial<AgentWorkItemStepView> = {},
): AgentWorkItemStepView {
  return {
    id: STEP_ID,
    key: "validate_scope",
    status: "completed",
    executionMode: "deterministic",
    evidenceCount: 1,
    lastReasonCode: null,
    ...overrides,
  };
}

function createApproval(
  overrides: Partial<AgentWorkItemApprovalView> = {},
): AgentWorkItemApprovalView {
  return {
    id: APPROVAL_ID,
    stepId: STEP_ID,
    status: "pending",
    requiredRole: "bcba",
    expiresAt: null,
    ...overrides,
  };
}

function createBlocker(
  overrides: Partial<AgentWorkItemBlockerView> = {},
): AgentWorkItemBlockerView {
  return {
    code: "missing_required_evidence",
    stepKey: "request_clinical_review",
    action: "resolve_required_evidence",
    ...overrides,
  };
}

function createView(
  overrides: Partial<AgentWorkItemView> = {},
): AgentWorkItemView {
  return {
    id: WORK_ITEM_ID,
    workflowKey: "assessment.iehp.prepare_for_clinical_review",
    workflowVersion: 1,
    objective: "Prepare this IEHP assessment for clinical review.",
    status: "needs_review",
    risk: "clinical",
    ownerUserId: USER_ID,
    dueAt: null,
    blockers: [createBlocker()],
    steps: [createStep()],
    approvals: [createApproval()],
    updatedAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

type HandlerDeps = Parameters<typeof createAgentWorkItemsHandler>[0];

function createDeps(
  overrides: Partial<HandlerDeps> = {},
): HandlerDeps & {
  calls: {
    createArgs: Array<Record<string, unknown>>;
    listArgs: string[];
    detailArgs: string[];
  };
} {
  const calls = {
    createArgs: [] as Array<Record<string, unknown>>,
    listArgs: [] as string[],
    detailArgs: [] as string[],
  };

  const deps: HandlerDeps = {
    getCorsHeaders: () => ({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      Vary: "Origin",
    }),
    getRuntimeMode: () => "shadow",
    getAuthenticatedUser: async () => ({ id: USER_ID }),
    loadAssessmentDocumentScope: async (assessmentDocumentId) => ({
      id: assessmentDocumentId,
      organizationId: ORGANIZATION_ID,
      clientId: CLIENT_ID,
    }),
    currentUserCanManage: async () => true,
    createAssessmentWorkItem: async (input) => {
      calls.createArgs.push({ ...input });
      return createView();
    },
    listWorkItemsByAssessmentDocument: async (assessmentDocumentId) => {
      calls.listArgs.push(assessmentDocumentId);
      return [createView()];
    },
    getWorkItemDetail: async (workItemId) => {
      calls.detailArgs.push(workItemId);
      return createView({ id: workItemId });
    },
  };

  return {
    ...deps,
    ...overrides,
    calls,
  };
}

function createRequest(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`http://localhost${path}`, init);
}

Deno.test("POST assessment-prep rejects unauthenticated callers", async () => {
  const deps = createDeps({
    getAuthenticatedUser: async () => null,
  });
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );

  assertEquals(response.status, 401);
  assertObjectMatch(await response.json(), {
    success: false,
    error: "Unauthorized",
  });
});

Deno.test("POST assessment-prep rejects extra request authority fields", async () => {
  const deps = createDeps();
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentDocumentId: ASSESSMENT_DOCUMENT_ID,
        organizationId: ORGANIZATION_ID,
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertObjectMatch(await response.json(), {
    success: false,
    error: "Invalid request body",
  });
});

Deno.test("POST assessment-prep rejects invalid, empty, and oversized JSON", async () => {
  const handler = createAgentWorkItemsHandler(createDeps());
  for (const body of ["", "{", JSON.stringify({ padding: "x".repeat(5000) })]) {
    const response = await handler(
      createRequest("/agent-work-items/assessment-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    assertEquals(response.status, 400);
  }
});

Deno.test("POST assessment-prep fails closed outside shadow or advisory mode", async () => {
  const deps = createDeps({
    getRuntimeMode: () => "disabled",
  });
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );

  assertEquals(response.status, 403);
  assertObjectMatch(await response.json(), {
    success: false,
    code: "runtime_mode_disabled",
  });
});

Deno.test("POST assessment-prep rejects unsupported workflow versions", async () => {
  const deps = createDeps();
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentDocumentId: ASSESSMENT_DOCUMENT_ID,
        workflowVersion: 2,
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertObjectMatch(await response.json(), {
    success: false,
    code: "unsupported_workflow_version",
  });
});

Deno.test("POST assessment-prep derives actor and document scope before calling the service RPC", async () => {
  const deps = createDeps();
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentDocumentId: ASSESSMENT_DOCUMENT_ID,
        workflowVersion: 1,
      }),
    }),
  );

  assertEquals(response.status, 201);
  assertEquals(deps.calls.createArgs.length, 1);
  assertEquals(deps.calls.createArgs[0], {
    actorUserId: USER_ID,
    organizationId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    assessmentDocumentId: ASSESSMENT_DOCUMENT_ID,
    workflowVersion: 1,
    dedupeKey: `assessment-prep:${ASSESSMENT_DOCUMENT_ID}:v1`,
  });

  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.data, createView());
  assertEquals(body.meta, { runtimeMode: "shadow" });
});

Deno.test("POST assessment-prep permits advisory mode without changing the bounded create contract", async () => {
  const handler = createAgentWorkItemsHandler(createDeps({
    getRuntimeMode: () => "advisory",
  }));
  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );
  assertEquals(response.status, 201);
});

Deno.test("POST assessment-prep returns 404 when the assessment document is not RLS-visible", async () => {
  const deps = createDeps({
    loadAssessmentDocumentScope: async () => null,
  });
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );

  assertEquals(response.status, 404);
  assertObjectMatch(await response.json(), {
    success: false,
    error: "Not found",
  });
});

Deno.test("POST assessment-prep returns 403 when the current DB manage capability is false", async () => {
  const deps = createDeps({
    currentUserCanManage: async () => false,
  });
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );

  assertEquals(response.status, 403);
  assertObjectMatch(await response.json(), {
    success: false,
    error: "Forbidden",
  });
});

Deno.test("GET list requires a valid assessment_document_id query parameter and returns sanitized views", async () => {
  const deps = createDeps({
    listWorkItemsByAssessmentDocument: async (assessmentDocumentId) => {
      deps.calls.listArgs.push(assessmentDocumentId);
      return [
        {
          ...createView(),
          internalError: "must_not_leak",
        },
      ] as unknown as AgentWorkItemView[];
    },
  });
  const handler = createAgentWorkItemsHandler(deps);

  const badResponse = await handler(
    createRequest("/agent-work-items?assessment_document_id=not-a-uuid"),
  );
  assertEquals(badResponse.status, 400);

  const okResponse = await handler(
    createRequest(
      `/agent-work-items?assessment_document_id=${ASSESSMENT_DOCUMENT_ID}`,
    ),
  );

  assertEquals(okResponse.status, 200);
  assertEquals(deps.calls.listArgs, [ASSESSMENT_DOCUMENT_ID]);
  const body = await okResponse.json();
  assertEquals(body.success, true);
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].id, WORK_ITEM_ID);
  assertEquals("internalError" in body.data[0], false);
  assertEquals(body.meta, { runtimeMode: "shadow" });
});

Deno.test("GET routes require authentication and reject malformed detail IDs", async () => {
  const unauthorized = createAgentWorkItemsHandler(createDeps({
    getAuthenticatedUser: async () => null,
  }));
  assertEquals(
    (await unauthorized(createRequest(`/agent-work-items/${WORK_ITEM_ID}`)))
      .status,
    401,
  );

  const handler = createAgentWorkItemsHandler(createDeps());
  assertEquals(
    (await handler(createRequest("/agent-work-items/not-a-uuid"))).status,
    400,
  );
});

Deno.test("OPTIONS is public and unsupported methods remain non-disclosing", async () => {
  const unauthenticated = createAgentWorkItemsHandler(createDeps({
    getAuthenticatedUser: async () => null,
  }));
  assertEquals(
    (await unauthenticated(
      createRequest("/agent-work-items", { method: "OPTIONS" }),
    )).status,
    204,
  );

  const handler = createAgentWorkItemsHandler(createDeps());
  assertEquals(
    (await handler(createRequest("/agent-work-items", { method: "PUT" })))
      .status,
    404,
  );

  const disallowedOrigin = await handler(
    createRequest("/agent-work-items", {
      headers: { Origin: "https://untrusted.example.invalid" },
    }),
  );
  assertEquals(
    disallowedOrigin.headers.get("access-control-allow-origin") ===
      "https://untrusted.example.invalid",
    false,
  );
  assertEquals(disallowedOrigin.headers.get("vary"), "Origin");
});

Deno.test("POST assessment-prep fails closed when runtime policy lookup fails", async () => {
  const handler = createAgentWorkItemsHandler(createDeps({
    getRuntimeMode: () => {
      throw new Error("policy unavailable");
    },
  }));

  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );

  assertEquals(response.status, 403);
  assertObjectMatch(await response.json(), { code: "runtime_mode_disabled" });
});

Deno.test("disabled mode rejects list and detail reads", async () => {
  const handler = createAgentWorkItemsHandler(createDeps({
    getRuntimeMode: () => "disabled",
  }));

  for (
    const path of [
      `/agent-work-items?assessment_document_id=${ASSESSMENT_DOCUMENT_ID}`,
      `/agent-work-items/${WORK_ITEM_ID}`,
    ]
  ) {
    const response = await handler(createRequest(path));
    assertEquals(response.status, 403);
    assertObjectMatch(await response.json(), { code: "runtime_mode_disabled" });
  }
});

Deno.test("create maps closed authorization and scope error classes without leaking internals", async () => {
  for (
    const expected of [
      new AgentWorkRequestError(403, "Forbidden", "forbidden"),
      new AgentWorkRequestError(404, "Not found", "not_found"),
      new AgentWorkRequestError(409, "Conflict", "conflict"),
    ] as const
  ) {
    const handler = createAgentWorkItemsHandler(createDeps({
      createAssessmentWorkItem: async () => {
        throw expected;
      },
    }));
    const response = await handler(
      createRequest("/agent-work-items/assessment-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
      }),
    );
    const body = await response.json();
    assertEquals(response.status, expected.status);
    assertEquals(body.code, expected.code);
    assertEquals(JSON.stringify(body).includes("scope mismatch"), false);
  }
});

Deno.test("unexpected create failures return a generic envelope", async () => {
  const handler = createAgentWorkItemsHandler(createDeps({
    createAssessmentWorkItem: async () => {
      throw new Error("private database detail");
    },
  }));
  const response = await handler(
    createRequest("/agent-work-items/assessment-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentDocumentId: ASSESSMENT_DOCUMENT_ID }),
    }),
  );
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(JSON.stringify(body).includes("private database detail"), false);
});

Deno.test("GET detail returns 404 for non-visible rows and maps only the strict DTO", async () => {
  const notFoundDeps = createDeps({
    getWorkItemDetail: async () => null,
  });
  const notFoundHandler = createAgentWorkItemsHandler(notFoundDeps);

  const notFound = await notFoundHandler(
    createRequest(`/agent-work-items/${WORK_ITEM_ID}`),
  );
  assertEquals(notFound.status, 404);

  const deps = createDeps({
    getWorkItemDetail: async (workItemId) => {
      deps.calls.detailArgs.push(workItemId);
      return ({
        ...createView({ id: workItemId }),
        credentials: { apiKey: "nope" },
      }) as AgentWorkItemView;
    },
  });
  const handler = createAgentWorkItemsHandler(deps);

  const response = await handler(
    createRequest(`/agent-work-items/${WORK_ITEM_ID}`),
  );

  assertEquals(response.status, 200);
  assertEquals(deps.calls.detailArgs, [WORK_ITEM_ID]);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.data.id, WORK_ITEM_ID);
  assertEquals("credentials" in body.data, false);
  assertEquals(body.meta, { runtimeMode: "shadow" });
});

Deno.test("unsupported owner cancel resume approval and reconcile routes are explicitly deferred", async () => {
  const deps = createDeps();
  const handler = createAgentWorkItemsHandler(deps);

  const paths = [
    `/agent-work-items/${WORK_ITEM_ID}/owner`,
    `/agent-work-items/${WORK_ITEM_ID}/cancel`,
    `/agent-work-items/${WORK_ITEM_ID}/resume`,
    `/agent-work-items/${WORK_ITEM_ID}/approvals/${APPROVAL_ID}/decision`,
    `/agent-work-items/${WORK_ITEM_ID}/reconcile`,
  ];

  for (const path of paths) {
    const response = await handler(
      createRequest(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    assertEquals(response.status, 501, path);
    assertObjectMatch(await response.json(), {
      success: false,
      code: "deferred_route",
    });
  }
});
