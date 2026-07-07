import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com"],
  ["APP_ENV", "production"],
]);

stubDenoEnv((key) => envValues.get(key) ?? "");

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

const authorizationRows = [
  {
    id: "auth-1",
    client_id: CLIENT_ID,
    organization_id: ORG_ID,
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    status: "approved",
    services: [
      { service_code: "97153", service_description: "Adaptive behavior treatment", approved_units: 40, unit_type: "Units" },
      { service_code: "97155", service_description: "Protocol modification", approved_units: 8, unit_type: "Hours" },
      { service_code: "0373T", service_description: "Adaptive behavior minute service", approved_units: 120, unit_type: "Minutes" },
    ],
  },
];

const sessionNotes = [
  {
    id: "note-1",
    authorization_id: "auth-1",
    service_code: "97153",
    session_duration: 60,
    session_date: "2026-07-08",
    organization_id: ORG_ID,
  },
  {
    id: "note-2",
    authorization_id: "auth-1",
    service_code: "97153",
    session_duration: 16,
    session_date: "2026-07-09",
    organization_id: ORG_ID,
  },
  {
    id: "note-3",
    authorization_id: "auth-1",
    service_code: "97155",
    session_duration: 90,
    session_date: "2026-07-09",
    organization_id: ORG_ID,
  },
  {
    id: "note-4",
    authorization_id: "auth-1",
    service_code: "0373T",
    session_duration: 45,
    session_date: "2026-07-09",
    organization_id: ORG_ID,
  },
];

const sessions = [
  {
    id: "session-1",
    client_id: CLIENT_ID,
    organization_id: ORG_ID,
    status: "completed",
    start_time: "2026-07-08T16:00:00.000Z",
    end_time: "2026-07-08T17:00:00.000Z",
    location_type: "Telehealth - school campus",
    cancellation_attribution: null,
    therapist_id: "therapist-1",
    therapist: { full_name: "Jane Analyst" },
  },
  {
    id: "session-2",
    client_id: CLIENT_ID,
    organization_id: ORG_ID,
    status: "cancelled",
    start_time: "2026-07-09T16:00:00.000Z",
    end_time: "2026-07-09T17:00:00.000Z",
    location_type: "Remote home visit",
    cancellation_attribution: "client",
    therapist_id: "therapist-2",
    therapist: { full_name: "Pat BCBA" },
  },
  {
    id: "session-3",
    client_id: CLIENT_ID,
    organization_id: ORG_ID,
    status: "cancelled",
    start_time: "2026-07-10T16:00:00.000Z",
    end_time: "2026-07-10T17:00:00.000Z",
    location_type: "clinic",
    cancellation_attribution: null,
    therapist_id: "therapist-2",
    therapist: { full_name: "Pat BCBA" },
  },
];

const loadModule = async () => import("../../supabase/functions/utilization-report/index.ts");

type QueryCall = { op: "select" | "eq" | "gte" | "lte"; column?: string; value?: unknown };

const createQuery = (data: unknown[], calls: QueryCall[]) => {
  const query = {
    select: vi.fn((value: string) => {
      calls.push({ op: "select", value });
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      calls.push({ op: "eq", column, value });
      return query;
    }),
    gte: vi.fn((column: string, value: unknown) => {
      calls.push({ op: "gte", column, value });
      return query;
    }),
    lte: vi.fn((column: string, value: unknown) => {
      calls.push({ op: "lte", column, value });
      return query;
    }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return query;
};

const createDb = (overrides: Partial<Record<string, unknown[]>> = {}) => {
  const callsByTable = new Map<string, QueryCall[]>();
  const tableData: Record<string, unknown[]> = {
    authorizations: authorizationRows,
    client_session_notes: sessionNotes,
    sessions,
    ...overrides,
  };
  const db = {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: ORG_ID, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const calls: QueryCall[] = [];
      callsByTable.set(table, calls);
      return createQuery(tableData[table] ?? [], calls);
    }),
  };
  return { db, callsByTable };
};

describe("utilization-report edge function", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns service-code utilization, cancellation, and location summaries", async () => {
    const mod = await loadModule();
    const report = mod.buildUtilizationReport({
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      authorizationRows,
      sessionNotes,
      sessions,
      range: { startDate: "2026-07-01", endDate: "2026-07-31" },
    });

    expect(report.serviceCodes).toEqual([
      {
        serviceCode: "0373T",
        description: "Adaptive behavior minute service",
        authorized: 120,
        used: 45,
        available: 75,
        utilizationPct: 37.5,
      },
      {
        serviceCode: "97153",
        description: "Adaptive behavior treatment",
        authorized: 40,
        used: 6,
        available: 34,
        utilizationPct: 15,
      },
      {
        serviceCode: "97155",
        description: "Protocol modification",
        authorized: 8,
        used: 1.5,
        available: 6.5,
        utilizationPct: 18.8,
      },
    ]);
    expect(report.cancellations).toEqual({ staff: 0, client: 1, unknown: 1 });
    expect(report.locations).toEqual({ telehealth: 1, home: 1, community: 0, clinic: 1, other: 0 });
  });

  it("excludes usage and cancellations outside the requested date range", async () => {
    const mod = await loadModule();
    const report = mod.buildUtilizationReport({
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      authorizationRows,
      sessionNotes,
      sessions,
      range: { startDate: "2026-07-09", endDate: "2026-07-09" },
    });

    expect(report.serviceCodes.find((row) => row.serviceCode === "97153")).toMatchObject({
      used: 2,
      available: 38,
      utilizationPct: 5,
    });
    expect(report.cancellations).toEqual({ staff: 0, client: 1, unknown: 0 });
    expect(report.locations).toEqual({ telehealth: 0, home: 1, community: 0, clinic: 0, other: 0 });
  });

  it("does not count denied authorization services as authorized units", async () => {
    const mod = await loadModule();
    const report = mod.buildUtilizationReport({
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      authorizationRows: [
        ...authorizationRows,
        {
          id: "auth-denied",
          client_id: CLIENT_ID,
          organization_id: ORG_ID,
          start_date: "2026-07-01",
          end_date: "2026-07-31",
          status: "denied",
          services: [
            { service_code: "97153", service_description: "Denied treatment", approved_units: 999, unit_type: "Units" },
          ],
        },
      ],
      sessionNotes,
      sessions,
      range: { startDate: "2026-07-01", endDate: "2026-07-31" },
    });

    expect(report.serviceCodes.find((row) => row.serviceCode === "97153")).toMatchObject({
      authorized: 40,
      used: 6,
      available: 34,
      utilizationPct: 15,
    });
  });

  it("loads only the caller organization, requested client, and requested date window", async () => {
    const mod = await loadModule();
    const { db, callsByTable } = createDb();
    const response = await mod.handleUtilizationReport(
      new Request(
        `https://edge.example/functions/v1/utilization-report?client_id=${CLIENT_ID}&start_date=2026-07-01&end_date=2026-07-31`,
        { method: "GET" },
      ),
      db as never,
    );

    expect(response.status).toBe(200);
    expect(db.from).toHaveBeenCalledWith("authorizations");
    expect(db.from).toHaveBeenCalledWith("client_session_notes");
    expect(db.from).toHaveBeenCalledWith("sessions");

    for (const calls of callsByTable.values()) {
      expect(calls).toEqual(expect.arrayContaining([
        { op: "eq", column: "organization_id", value: ORG_ID },
        { op: "eq", column: "client_id", value: CLIENT_ID },
      ]));
    }
    expect(callsByTable.get("authorizations")).toEqual(expect.arrayContaining([
      {
        op: "select",
        value: "id,client_id,organization_id,start_date,end_date,status,services:authorization_services(service_code,service_description,approved_units,unit_type)",
      },
      { op: "eq", column: "status", value: "approved" },
      { op: "gte", column: "end_date", value: "2026-07-01" },
      { op: "lte", column: "start_date", value: "2026-07-31" },
    ]));
    expect(callsByTable.get("client_session_notes")).toEqual(expect.arrayContaining([
      { op: "gte", column: "session_date", value: "2026-07-01" },
      { op: "lte", column: "session_date", value: "2026-07-31" },
    ]));
    expect(callsByTable.get("sessions")).toEqual(expect.arrayContaining([
      { op: "gte", column: "start_time", value: "2026-07-01T00:00:00.000Z" },
      { op: "lte", column: "start_time", value: "2026-07-31T23:59:59.999Z" },
    ]));
  });

  it("rejects non-admin callers through the protected route wrapper", async () => {
    const auth = await import("../../supabase/functions/_shared/auth-middleware.ts");
    vi.spyOn(auth.authMiddlewareDeps, "getUserContext").mockResolvedValue({
      user: { id: "therapist-user", email: null },
      profile: { id: "therapist-user", email: null, role: "therapist", is_active: true },
    });
    const mod = await loadModule();

    const response = await mod.default(
      new Request(`https://edge.example/functions/v1/utilization-report?client_id=${CLIENT_ID}`, {
        method: "GET",
        headers: { Authorization: "Bearer therapist-token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "forbidden",
      message: "Insufficient permissions",
    });
  });

  it("rejects invalid report date filters", async () => {
    const mod = await loadModule();
    const { db } = createDb();
    const response = await mod.handleUtilizationReport(
      new Request(`https://edge.example/functions/v1/utilization-report?client_id=${CLIENT_ID}&start_date=07-01-2026`, {
        method: "GET",
      }),
      db as never,
    );

    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("normalizes legacy location values into report buckets", async () => {
    const mod = await loadModule();
    expect(mod.normalizeSessionLocation("TH")).toBe("telehealth");
    expect(mod.normalizeSessionLocation("in_home")).toBe("home");
    expect(mod.normalizeSessionLocation("Community outing")).toBe("community");
    expect(mod.normalizeSessionLocation("in_clinic")).toBe("clinic");
    expect(mod.normalizeSessionLocation("unknown place")).toBe("other");
  });
});
