import { createRequestClient } from "../_shared/database.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";

export interface UtilizationAuthorizationServiceRow {
  readonly service_code: string;
  readonly service_description: string | null;
  readonly approved_units: number | null;
  readonly unit_type: string | null;
}

export interface UtilizationAuthorizationRow {
  readonly id: string;
  readonly client_id: string;
  readonly organization_id: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: string;
  readonly services: readonly UtilizationAuthorizationServiceRow[] | null;
}

export interface UtilizationSessionNoteRow {
  readonly id: string;
  readonly authorization_id: string | null;
  readonly service_code: string;
  readonly session_duration: number | null;
  readonly session_date: string;
  readonly organization_id: string;
}

export type CancellationAttribution = "staff" | "client" | "unknown";
export type LocationBucket = "telehealth" | "home" | "community" | "clinic" | "other";

export interface UtilizationSessionRow {
  readonly id: string;
  readonly client_id: string;
  readonly organization_id: string;
  readonly status: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly location_type: string | null;
  readonly cancellation_attribution: string | null;
}

export interface UtilizationReportInput {
  readonly organizationId: string;
  readonly clientId: string;
  readonly authorizationRows: readonly UtilizationAuthorizationRow[];
  readonly sessionNotes: readonly UtilizationSessionNoteRow[];
  readonly sessions: readonly UtilizationSessionRow[];
  readonly range: { readonly startDate?: string | null; readonly endDate?: string | null };
}

export interface UtilizationServiceCodeRow {
  readonly serviceCode: string;
  readonly description: string;
  readonly authorized: number;
  readonly used: number;
  readonly available: number;
  readonly utilizationPct: number;
}

export interface UtilizationReport {
  readonly clientId: string;
  readonly organizationId: string;
  readonly serviceCodes: UtilizationServiceCodeRow[];
  readonly cancellations: Record<CancellationAttribution, number>;
  readonly locations: Record<LocationBucket, number>;
}

type DbClient = ReturnType<typeof createRequestClient>;

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });

const isUuid = (value: string | null): value is string =>
  Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));

const parseDateOnly = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isDateParam = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateOnly(value) !== null);

const isDateInRange = (
  value: string | null | undefined,
  range: UtilizationReportInput["range"],
): boolean => {
  const timestamp = parseDateOnly(value);
  if (timestamp === null) {
    return false;
  }
  const start = parseDateOnly(range.startDate);
  const end = parseDateOnly(range.endDate);
  return (start === null || timestamp >= start) && (end === null || timestamp <= end);
};

const unitsFromMinutes = (minutes: number, unitType: string | null | undefined): number => {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }

  const normalizedUnitType = unitType?.toLowerCase() ?? "unit";
  if (normalizedUnitType.includes("hour")) {
    return Math.round((minutes / 60) * 100) / 100;
  }
  if (normalizedUnitType.includes("minute")) {
    return Math.round(minutes * 100) / 100;
  }
  return Math.ceil(minutes / 15);
};

const roundPercent = (value: number): number => Math.round(value * 10) / 10;

export const normalizeSessionLocation = (value: string | null | undefined): LocationBucket => {
  const normalized = value?.trim().toLowerCase().replace(/[_-]+/g, " ") ?? "";
  if (!normalized) {
    return "other";
  }
  if (normalized.includes("home")) {
    return "home";
  }
  if (normalized === "th" || normalized.includes("telehealth") || normalized.includes("remote")) {
    return "telehealth";
  }
  if (normalized.includes("community")) {
    return "community";
  }
  if (normalized.includes("clinic") || normalized.includes("center")) {
    return "clinic";
  }
  return "other";
};

const normalizeCancellationAttribution = (value: string | null): CancellationAttribution =>
  value === "staff" || value === "client" || value === "unknown" ? value : "unknown";

export const buildUtilizationReport = (input: UtilizationReportInput): UtilizationReport => {
  const serviceRows = new Map<string, { description: string; authorized: number; used: number }>();
  const serviceUnitsByAuthorization = new Map<string, string | null>();
  const usageMinutesByAuthorizationService = new Map<string, number>();
  const authorizationIds = new Set<string>();

  input.authorizationRows
    .filter((authorization) =>
      authorization.organization_id === input.organizationId &&
      authorization.client_id === input.clientId &&
      authorization.status === "approved"
    )
    .forEach((authorization) => {
      authorizationIds.add(authorization.id);
      (authorization.services ?? []).forEach((service) => {
        const existing = serviceRows.get(service.service_code) ?? {
          description: service.service_description ?? "",
          authorized: 0,
          used: 0,
        };
        existing.description = existing.description || service.service_description || "";
        existing.authorized += service.approved_units ?? 0;
        serviceRows.set(service.service_code, existing);
        serviceUnitsByAuthorization.set(`${authorization.id}:${service.service_code}`, service.unit_type);
      });
    });

  input.sessionNotes
    .filter((note) =>
      note.organization_id === input.organizationId &&
      note.authorization_id !== null &&
      authorizationIds.has(note.authorization_id) &&
      isDateInRange(note.session_date, input.range)
    )
    .forEach((note) => {
      const key = `${note.authorization_id}:${note.service_code}`;
      usageMinutesByAuthorizationService.set(
        key,
        (usageMinutesByAuthorizationService.get(key) ?? 0) + (note.session_duration ?? 0),
      );
    });

  usageMinutesByAuthorizationService.forEach((minutes, key) => {
    const separatorIndex = key.indexOf(":");
    const serviceCode = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key;
    const row = serviceRows.get(serviceCode) ?? {
      description: "",
      authorized: 0,
      used: 0,
    };
    row.used += unitsFromMinutes(minutes, serviceUnitsByAuthorization.get(key));
    serviceRows.set(serviceCode, row);
  });

  const cancellations: Record<CancellationAttribution, number> = { staff: 0, client: 0, unknown: 0 };
  const locations: Record<LocationBucket, number> = { telehealth: 0, home: 0, community: 0, clinic: 0, other: 0 };

  input.sessions
    .filter((session) =>
      session.organization_id === input.organizationId &&
      session.client_id === input.clientId &&
      isDateInRange(session.start_time, input.range)
    )
    .forEach((session) => {
      locations[normalizeSessionLocation(session.location_type)] += 1;
      if (session.status === "cancelled") {
        cancellations[normalizeCancellationAttribution(session.cancellation_attribution)] += 1;
      }
    });

  return {
    clientId: input.clientId,
    organizationId: input.organizationId,
    serviceCodes: Array.from(serviceRows.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([serviceCode, row]) => ({
        serviceCode,
        description: row.description,
        authorized: row.authorized,
        used: Math.round(row.used * 100) / 100,
        available: Math.max(0, Math.round((row.authorized - row.used) * 100) / 100),
        utilizationPct: row.authorized > 0 ? roundPercent((row.used / row.authorized) * 100) : 0,
      })),
    cancellations,
    locations,
  };
};

const requireOrg = async (db: DbClient): Promise<string | null> => {
  const { data, error } = await db.rpc("current_user_organization_id");
  if (error || typeof data !== "string" || data.length === 0) {
    return null;
  }
  return data;
};

export const handleUtilizationReport = async (
  req: Request,
  db: DbClient = createRequestClient(req),
) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "GET") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  if (!isUuid(clientId)) {
    return json(req, { error: "client_id is required" }, 400);
  }
  if ((startDate && !isDateParam(startDate)) || (endDate && !isDateParam(endDate))) {
    return json(req, { error: "start_date and end_date must be YYYY-MM-DD" }, 400);
  }

  const organizationId = await requireOrg(db);
  if (!organizationId) {
    return json(req, { error: "Forbidden" }, 403);
  }

  let authorizationsQuery = db
    .from("authorizations")
    .select("id,client_id,organization_id,start_date,end_date,status,services:authorization_services(service_code,service_description,approved_units,unit_type)")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "approved");
  if (isDateParam(startDate)) {
    authorizationsQuery = authorizationsQuery.gte("end_date", startDate);
  }
  if (isDateParam(endDate)) {
    authorizationsQuery = authorizationsQuery.lte("start_date", endDate);
  }

  let sessionNotesQuery = db
    .from("client_session_notes")
    .select("id,authorization_id,organization_id,service_code,session_duration,session_date")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);
  if (isDateParam(startDate)) {
    sessionNotesQuery = sessionNotesQuery.gte("session_date", startDate);
  }
  if (isDateParam(endDate)) {
    sessionNotesQuery = sessionNotesQuery.lte("session_date", endDate);
  }

  let sessionsQuery = db
    .from("sessions")
    .select("id,client_id,organization_id,status,start_time,end_time,location_type,cancellation_attribution")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);
  if (isDateParam(startDate)) {
    sessionsQuery = sessionsQuery.gte("start_time", `${startDate}T00:00:00.000Z`);
  }
  if (isDateParam(endDate)) {
    sessionsQuery = sessionsQuery.lte("start_time", `${endDate}T23:59:59.999Z`);
  }

  const [authorizations, sessionNotes, sessions] = await Promise.all([
    authorizationsQuery,
    sessionNotesQuery,
    sessionsQuery,
  ]);

  if (authorizations.error || sessionNotes.error || sessions.error) {
    return json(req, { error: "Failed to load utilization report data" }, 502);
  }

  return json(req, buildUtilizationReport({
    organizationId,
    clientId,
    authorizationRows: (authorizations.data ?? []) as unknown as UtilizationAuthorizationRow[],
    sessionNotes: (sessionNotes.data ?? []) as unknown as UtilizationSessionNoteRow[],
    sessions: (sessions.data ?? []) as unknown as UtilizationSessionRow[],
    range: { startDate, endDate },
  }));
};

const handler = createProtectedRoute((req) => handleUtilizationReport(req), RouteOptions.admin);

Deno.serve(handler);

export default handler;
