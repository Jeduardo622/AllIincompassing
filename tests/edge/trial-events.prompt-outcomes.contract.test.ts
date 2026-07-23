import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequestClientMock = vi.fn();
const supabaseAdminFromMock = vi.fn();
const denoServeMock = vi.fn();

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const GOAL_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const THERAPIST_ID = "66666666-6666-4666-8666-666666666666";

async function loadTrialEventsModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: { from: supabaseAdminFromMock },
  }));
  vi.doMock("../../supabase/functions/_shared/cors.ts", () => ({
    corsHeadersForRequest: () => ({}),
  }));
  vi.doMock("../../supabase/functions/_shared/auth-middleware.ts", () => ({
    createProtectedRoute: (handler: (req: Request) => Promise<Response>) => handler,
    RouteOptions: { programsGoals: {} },
  }));

  vi.stubGlobal("Deno", {
    serve: denoServeMock,
    env: { get: vi.fn(() => "") },
  });

  return import("../../supabase/functions/trial-events/index.ts");
}

const buildReadRequest = (query: string) =>
  new Request(`https://edge.example/functions/v1/trial-events?${query}`, {
    method: "GET",
    headers: { Authorization: "Bearer test-token", apikey: "anon-key" },
  });

const buildSelectBuilder = <TRow>(rows: TRow[], error: unknown = null, status = error ? 500 : 200) => {
  const builder: any = {};
  const chain = () => builder;
  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.limit = vi.fn(async () => ({ data: rows, error, status }));
  return builder;
};

const buildTrialEventsQueryBuilder = (rows: unknown[], error: unknown = null, status = error ? 500 : 200) => {
  const builder: any = {};
  const chain = () => builder;
  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.gte = vi.fn(() => chain());
  builder.lt = vi.fn(() => chain());
  builder.not = vi.fn(() => chain());
  builder.in = vi.fn(() => chain());
  builder.order = vi.fn(() => chain());
  builder.limit = vi.fn(async () => ({ data: rows, error, status }));
  return builder;
};

const buildLegacyReadBuilder = (rows: unknown[]) => {
  const builder: any = {};
  const chain = () => builder;
  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.order = vi.fn(() => chain());
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null, status: 200 }).then(resolve);
  return builder;
};

const buildInsertBuilder = (rows: unknown[]) => {
  const builder: any = {};
  const chain = () => builder;
  builder.insert = vi.fn(() => chain());
  builder.select = vi.fn(() => chain());
  builder.limit = vi.fn(async () => ({ data: rows, error: null, status: 201 }));
  return builder;
};

const createBaseRequestClient = () => ({
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "actor-user" } }, error: null })),
  },
  rpc: vi.fn(async (fn: string) => {
    if (fn === "current_user_organization_id") {
      return { data: ORG_ID, error: null };
    }
    if (fn === "current_user_can_capture_trial_event") {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected rpc ${fn}`);
  }),
  from: vi.fn(),
});

describe("trial-events edge prompt outcome parity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects prompt outcome reads that mix session or target anchors", async () => {
    createRequestClientMock.mockReturnValue(createBaseRequestClient());
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z&target_id=${TARGET_ID}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "view=prompt_outcomes cannot be combined with session_id or target_id",
    });
    expect(supabaseAdminFromMock).not.toHaveBeenCalled();
  });

  it("rejects non-UTC day boundaries before capability or scope checks", async () => {
    const db = createBaseRequestClient();
    createRequestClientMock.mockReturnValue(db);
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T12:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "start_at and end_before must be UTC day boundaries at 00:00:00.000Z",
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseAdminFromMock).not.toHaveBeenCalled();
  });

  it("rejects a non-increasing prompt outcome range", async () => {
    createRequestClientMock.mockReturnValue(createBaseRequestClient());
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-02T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "start_at must be before end_before" });
    expect(supabaseAdminFromMock).not.toHaveBeenCalled();
  });

  it("checks capability before privileged client and goal scope lookups", async () => {
    const db = createBaseRequestClient();
    db.rpc = vi.fn(async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: ORG_ID, error: null };
      }
      if (fn === "current_user_can_capture_trial_event") {
        return { data: false, error: null };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    });
    createRequestClientMock.mockReturnValue(db);
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(db.rpc).toHaveBeenNthCalledWith(2, "current_user_can_capture_trial_event", {
      target_organization_id: ORG_ID,
      target_client_id: CLIENT_ID,
    });
    expect(supabaseAdminFromMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the prompt outcome capability check fails upstream", async () => {
    const db = createBaseRequestClient();
    db.rpc = vi.fn(async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: ORG_ID, error: null };
      }
      if (fn === "current_user_can_capture_trial_event") {
        return { data: null, error: { message: "rpc unavailable" } };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    });
    createRequestClientMock.mockReturnValue(db);
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate trial-event read access" });
    expect(supabaseAdminFromMock).not.toHaveBeenCalled();
  });

  it("returns the generic 403 goal-scope response for a missing or cross-client goal", async () => {
    createRequestClientMock.mockReturnValue(createBaseRequestClient());
    supabaseAdminFromMock.mockImplementation((table: string) => {
      if (table === "clients") {
        return buildSelectBuilder([{ id: CLIENT_ID }]);
      }
      if (table === "goals") {
        return buildSelectBuilder([]);
      }
      throw new Error(`Unexpected admin table ${table}`);
    });
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "goal_id is not in scope for this client" });
  });

  it("preserves upstream status for prompt outcome scope and data failures", async () => {
    createRequestClientMock.mockReturnValue(createBaseRequestClient());
    supabaseAdminFromMock.mockReturnValue(buildSelectBuilder([], { message: "unavailable" }, 503));
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Unable to validate trial-event client access" });
  });

  it("queries prompt outcomes with request-scoped filters and strips joined session payloads", async () => {
    const trialEventsBuilder = buildTrialEventsQueryBuilder([
      {
        id: "event-1",
        session_id: SESSION_ID,
        target_id: TARGET_ID,
        goal_id: GOAL_ID,
        therapist_id: THERAPIST_ID,
        response: "correct",
        event_timestamp: "2026-07-02T07:30:00.000Z",
        sessions: {
          client_session_notes: [{ session_date: "2026-07-01" }],
        },
      },
    ]);
    const db = createBaseRequestClient();
    db.from.mockImplementation((table: string) => {
      if (table === "trial_events") {
        return trialEventsBuilder;
      }
      throw new Error(`Unexpected request-scoped table ${table}`);
    });
    createRequestClientMock.mockReturnValue(db);
    supabaseAdminFromMock.mockImplementation((table: string) => {
      if (table === "clients") {
        return buildSelectBuilder([{ id: CLIENT_ID }]);
      }
      if (table === "goals") {
        return buildSelectBuilder([{ id: GOAL_ID, client_id: CLIENT_ID }]);
      }
      throw new Error(`Unexpected admin table ${table}`);
    });
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "event-1",
        session_id: SESSION_ID,
        target_id: TARGET_ID,
        goal_id: GOAL_ID,
        therapist_id: THERAPIST_ID,
        response: "correct",
        event_timestamp: "2026-07-02T07:30:00.000Z",
      },
    ]);
    expect(db.from).toHaveBeenCalledWith("trial_events");
    expect(trialEventsBuilder.select).toHaveBeenCalledWith(
      "id,session_id,target_id,goal_id,therapist_id,response,event_timestamp,sessions!inner(client_session_notes!inner(session_date))",
    );
    expect(trialEventsBuilder.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
    expect(trialEventsBuilder.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(trialEventsBuilder.eq).toHaveBeenCalledWith("goal_id", GOAL_ID);
    expect(trialEventsBuilder.eq).toHaveBeenCalledWith("sessions.client_session_notes.organization_id", ORG_ID);
    expect(trialEventsBuilder.eq).toHaveBeenCalledWith("sessions.client_session_notes.client_id", CLIENT_ID);
    expect(trialEventsBuilder.gte).toHaveBeenCalledWith("sessions.client_session_notes.session_date", "2026-07-01");
    expect(trialEventsBuilder.lt).toHaveBeenCalledWith("sessions.client_session_notes.session_date", "2026-07-02");
    expect(trialEventsBuilder.not).toHaveBeenCalledWith("prompt_type", "is", null);
    expect(trialEventsBuilder.in).toHaveBeenCalledWith("response", ["correct", "incorrect", "noResponse"]);
    expect(trialEventsBuilder.order).toHaveBeenNthCalledWith(1, "event_timestamp", { ascending: true });
    expect(trialEventsBuilder.order).toHaveBeenNthCalledWith(2, "trial_number", { ascending: true });
    expect(trialEventsBuilder.limit).toHaveBeenCalledWith(5001);
  });

  it("returns 422 when prompt outcomes exceed the 5000 row cap", async () => {
    const db = createBaseRequestClient();
    db.from.mockImplementation((table: string) => {
      if (table === "trial_events") {
        return buildTrialEventsQueryBuilder(
          Array.from({ length: 5001 }, (_, index) => ({
            id: `event-${index + 1}`,
            session_id: SESSION_ID,
            target_id: TARGET_ID,
            goal_id: GOAL_ID,
            therapist_id: THERAPIST_ID,
            response: "correct",
            event_timestamp: "2026-07-01T00:00:00.000Z",
          })),
        );
      }
      throw new Error(`Unexpected request-scoped table ${table}`);
    });
    createRequestClientMock.mockReturnValue(db);
    supabaseAdminFromMock.mockImplementation((table: string) => {
      if (table === "clients") {
        return buildSelectBuilder([{ id: CLIENT_ID }]);
      }
      if (table === "goals") {
        return buildSelectBuilder([{ id: GOAL_ID, client_id: CLIENT_ID }]);
      }
      throw new Error(`Unexpected admin table ${table}`);
    });
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(
      buildReadRequest(
        `view=prompt_outcomes&client_id=${CLIENT_ID}&goal_id=${GOAL_ID}&start_at=2026-07-01T00:00:00.000Z&end_before=2026-07-02T00:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Prompt outcome query exceeds 5000 events" });
  });

  it.each([
    ["session_id", SESSION_ID, "sessions"],
    ["target_id", TARGET_ID, "goal_targets"],
  ])("preserves legacy GET by %s", async (parameter, value, scopeTable) => {
    const legacyRows = [{ id: "legacy-event-1" }];
    const legacyBuilder = buildLegacyReadBuilder(legacyRows);
    const db = createBaseRequestClient();
    db.from.mockImplementation((table: string) => {
      if (table === "trial_events") {
        return legacyBuilder;
      }
      throw new Error(`Unexpected request-scoped table ${table}`);
    });
    createRequestClientMock.mockReturnValue(db);
    supabaseAdminFromMock.mockImplementation((table: string) => {
      if (table === scopeTable && table === "sessions") {
        return buildSelectBuilder([{ id: SESSION_ID, client_id: CLIENT_ID, therapist_id: THERAPIST_ID }]);
      }
      if (table === scopeTable && table === "goal_targets") {
        return buildSelectBuilder([
          { id: TARGET_ID, client_id: CLIENT_ID, goal_id: GOAL_ID, measurement_type: "correctIncorrect" },
        ]);
      }
      throw new Error(`Unexpected admin table ${table}`);
    });
    const mod = await loadTrialEventsModule();

    const response = await mod.handleTrialEvents(buildReadRequest(`${parameter}=${value}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(legacyRows);
    expect(legacyBuilder.eq).toHaveBeenCalledWith(parameter, value);
  });

  it("preserves legacy POST trial-event creation", async () => {
    const createdRow = { id: "created-event-1" };
    const insertBuilder = buildInsertBuilder([createdRow]);
    const db = createBaseRequestClient();
    db.rpc = vi.fn(async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: ORG_ID, error: null };
      }
      if (fn === "current_user_can_capture_trial_event") {
        return { data: true, error: null };
      }
      if (fn === "session_has_locked_note") {
        return { data: false, error: null };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    });
    db.from.mockImplementation((table: string) => {
      if (table === "trial_events") {
        return insertBuilder;
      }
      throw new Error(`Unexpected request-scoped table ${table}`);
    });
    createRequestClientMock.mockReturnValue(db);
    supabaseAdminFromMock.mockImplementation((table: string) => {
      if (table === "goal_targets") {
        return buildSelectBuilder([
          { id: TARGET_ID, client_id: CLIENT_ID, goal_id: GOAL_ID, measurement_type: "correctIncorrect" },
        ]);
      }
      if (table === "sessions") {
        return buildSelectBuilder([{ id: SESSION_ID, client_id: CLIENT_ID, therapist_id: THERAPIST_ID }]);
      }
      throw new Error(`Unexpected admin table ${table}`);
    });
    const mod = await loadTrialEventsModule();
    const request = new Request("https://edge.example/functions/v1/trial-events", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: SESSION_ID,
        target_id: TARGET_ID,
        trial_number: 1,
        response: "correct",
      }),
    });

    const response = await mod.handleTrialEvents(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(createdRow);
    expect(insertBuilder.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        organization_id: ORG_ID,
        client_id: CLIENT_ID,
        session_id: SESSION_ID,
        target_id: TARGET_ID,
        goal_id: GOAL_ID,
        therapist_id: THERAPIST_ID,
        trial_number: 1,
        response: "correct",
        created_by: "actor-user",
      }),
    ]);
  });
});
