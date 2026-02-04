import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/auth-middleware.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

interface SessionFilters {
  status?: string;
  start_date?: string;
  end_date?: string;
  location_type?: string;
  therapist_id?: string;
  client_id?: string;
  page?: number;
  limit?: number;
}
interface OptimizedSessionResponse {
  sessions: Array<{
    id: string;
    start_time: string;
    end_time: string;
    status: string;
    location_type: string;
    notes?: string;
    created_at: string | null;
    created_by: string | null;
    updated_at: string | null;
    updated_by: string | null;
    program_id?: string | null;
    goal_id?: string | null;
    started_at?: string | null;
    therapist: { id: string; full_name: string; email: string };
    client: { id: string; full_name: string; email: string };
    authorization?: { id: string; sessions_remaining: number };
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  summary: {
    totalSessions: number;
    completedSessions: number;
    upcomingSessions: number;
    cancelledSessions: number;
  };
}

const MAX_LIMIT = 100;
const SESSION_SELECT = "id, start_time, end_time, status, location_type, notes, created_at, created_by, updated_at, updated_by, therapist_id, client_id, program_id, goal_id, started_at, authorization_id, therapist:therapists!inner(id, full_name, email), client:clients!inner(id, full_name, email), authorization:authorizations(id, authorized_sessions, sessions_used)";

const normalizeRoles = (roleRows: unknown) => (
  Array.isArray(roleRows)
    ? roleRows.flatMap((entry: { roles?: unknown }) => {
        const value = entry?.roles;
        if (Array.isArray(value)) {
          return value.filter((role): role is string => typeof role === "string");
        }
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              return parsed.filter((role): role is string => typeof role === "string");
            }
          } catch {
            return value.split(",").map((role) => role.trim()).filter(Boolean);
          }
        }
        return [];
      })
    : []
);

const buildSessionBaseQuery = (db: ReturnType<typeof createRequestClient>, orgId: string) => (
  orgScopedQuery(db, "sessions", orgId).select(SESSION_SELECT, { count: "exact" })
);

const buildSessionSummaryQuery = (db: ReturnType<typeof createRequestClient>, orgId: string) => (
  orgScopedQuery(db, "sessions", orgId).select("status", { count: "exact" })
);

export const __TESTING__ = {
  normalizeRoles,
  buildSessionBaseQuery,
  buildSessionSummaryQuery,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = getRequestId(req);
  try {
    const db = createRequestClient(req);
    const currentUser = await getUserOrThrow(db);

    const orgId = await requireOrg(db);
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(`sessions-optimized:${orgId}:${ip}`, 60, 60_000);
    if (!limiter.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { "Retry-After": String(limiter.retryAfter ?? 60) },
      });
    }

    const url = new URL(req.url);
    const requestedTherapistId = url.searchParams.get("therapist_id") || undefined;
    const requestedClientId = url.searchParams.get("client_id") || undefined;
    const filters: SessionFilters = {
      status: url.searchParams.get("status") || undefined,
      start_date: url.searchParams.get("start_date") || undefined,
      end_date: url.searchParams.get("end_date") || undefined,
      location_type: url.searchParams.get("location_type") || undefined,
      therapist_id: requestedTherapistId,
      client_id: requestedClientId,
      page: parseInt(url.searchParams.get("page") || "1", 10),
      limit: Math.min(parseInt(url.searchParams.get("limit") || "50", 10), MAX_LIMIT),
    };

    const { data: roleRows } = await db.rpc("get_user_roles");
    const flattenedRoles = normalizeRoles(roleRows);
    const isAdmin = flattenedRoles.some((role) => role === "admin" || role === "super_admin");

    let effectiveTherapistId: string | null = null;
    if (!isAdmin) {
      const { data: link } = await db
        .from("user_therapist_links")
        .select("therapist_id")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      effectiveTherapistId = link?.therapist_id ?? null;

      if (!effectiveTherapistId) {
        const { data: selfTherapist } = await db
          .from("therapists")
          .select("id")
          .eq("organization_id", orgId)
          .eq("id", currentUser.id)
          .maybeSingle();
        effectiveTherapistId = selfTherapist?.id ?? null;
      }

      if (!effectiveTherapistId) {
        return errorEnvelope({ requestId, code: "forbidden", message: "Therapist profile not found", status: 403 });
      }

      const hasRole = await assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: effectiveTherapistId });
      if (!hasRole) {
        return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403 });
      }
    }

    if (requestedTherapistId && isAdmin) {
      const { data: therapistMatch } = await db
        .from("therapists")
        .select("id")
        .eq("organization_id", orgId)
        .eq("id", requestedTherapistId)
        .maybeSingle();
      if (!therapistMatch) {
        return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403 });
      }
    }

    if (requestedClientId && isAdmin) {
      const { data: clientMatch } = await db
        .from("clients")
        .select("id")
        .eq("organization_id", orgId)
        .eq("id", requestedClientId)
        .maybeSingle();
      if (!clientMatch) {
        return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403 });
      }
    }

    const therapistIdFilter = isAdmin
      ? requestedTherapistId ?? effectiveTherapistId ?? undefined
      : effectiveTherapistId ?? undefined;
    const clientIdFilter = requestedClientId ?? undefined;

    let query = buildSessionBaseQuery(db, orgId);

    if (therapistIdFilter) query = query.eq("therapist_id", therapistIdFilter);
    if (clientIdFilter) query = query.eq("client_id", clientIdFilter);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.location_type) query = query.eq("location_type", filters.location_type);
    if (filters.start_date) query = query.gte("start_time", `${filters.start_date}T00:00:00`);
    if (filters.end_date) query = query.lte("start_time", `${filters.end_date}T23:59:59`);

    const offset = ((filters.page || 1) - 1) * (filters.limit || 50);
    query = query.range(offset, offset + (filters.limit || 50) - 1);
    query = query.order("start_time", { ascending: false });

    const { data: sessions, error, count } = await query;
    if (error) throw error;

    let summaryQuery = buildSessionSummaryQuery(db, orgId);
    if (therapistIdFilter) summaryQuery = summaryQuery.eq("therapist_id", therapistIdFilter);
    if (clientIdFilter) summaryQuery = summaryQuery.eq("client_id", clientIdFilter);
    if (filters.start_date) summaryQuery = summaryQuery.gte("start_time", `${filters.start_date}T00:00:00`);
    if (filters.end_date) summaryQuery = summaryQuery.lte("start_time", `${filters.end_date}T23:59:59`);

    const { data: allFilteredSessions, error: summaryError } = await summaryQuery;
    if (summaryError) throw summaryError;

    const totalSessions = count || 0;
    const completedSessions = allFilteredSessions?.filter((s: { status?: string }) => s.status === "completed").length || 0;
    const upcomingSessions = allFilteredSessions?.filter((s: { status?: string }) => s.status === "scheduled").length || 0;
    const cancelledSessions = allFilteredSessions?.filter((s: { status?: string }) => s.status === "cancelled").length || 0;

    const formattedSessions = sessions?.map((session) => ({
      id: session.id,
      start_time: session.start_time,
      end_time: session.end_time,
      status: session.status,
      location_type: session.location_type,
      notes: session.notes,
      created_at: session.created_at ?? null,
      created_by: session.created_by ?? null,
      updated_at: session.updated_at ?? null,
      updated_by: session.updated_by ?? null,
      program_id: session.program_id ?? null,
      goal_id: session.goal_id ?? null,
      started_at: session.started_at ?? null,
      therapist: session.therapist,
      client: session.client,
      authorization: session.authorization
        ? {
            id: session.authorization.id,
            sessions_remaining: (session.authorization.authorized_sessions || 0) - (session.authorization.sessions_used || 0),
          }
        : undefined,
    })) || [];

    const totalPages = Math.ceil(totalSessions / (filters.limit || 50));
    const currentPage = filters.page || 1;

    const response: OptimizedSessionResponse = {
      sessions: formattedSessions,
      pagination: {
        page: currentPage,
        limit: filters.limit || 50,
        total: totalSessions,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
      summary: { totalSessions, completedSessions, upcomingSessions, cancelledSessions },
    };

    return new Response(
      JSON.stringify({
        success: true,
        data: response,
        filters,
        requestId,
        performance: { cached: false, queryTime: new Date().toISOString() },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const status = typeof (error as { status?: number }).status === "number"
      ? (error as { status: number }).status
      : 500;
    const code = status === 403 ? "forbidden" : "internal_error";
    const message = status === 403 ? "Access denied" : "Unexpected error";
    console.error("Optimized sessions error:", error);
    return errorEnvelope({ requestId, code, message, status });
  }
});
