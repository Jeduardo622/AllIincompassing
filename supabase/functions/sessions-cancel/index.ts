import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CancelPayload {
  hold_key?: unknown;
  session_ids?: unknown;
  date?: unknown;
  therapist_id?: unknown;
  reason?: unknown;
}

interface SessionRecord {
  id?: unknown;
  status?: unknown;
}

interface SessionCancellationSummary {
  cancelledCount: number;
  alreadyCancelledCount: number;
  totalCount: number;
  cancelledSessionIds: string[];
  alreadyCancelledSessionIds: string[];
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

async function ensureAuthenticated(req: Request) {
  const client = createRequestClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  return data.user;
}

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isAdminRole(role: string | null): boolean {
  return role === "admin" || role === "super_admin";
}

function isTherapistRole(role: string | null): boolean {
  return role === "therapist";
}

function normalizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  for (const item of value) {
    let normalized = "";
    if (typeof item === "string") {
      normalized = item.trim();
    } else if (typeof item === "number" || typeof item === "bigint") {
      normalized = String(item);
    }

    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }

  return Array.from(seen);
}

function buildDateRange(value: unknown): { start: string; end: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const [yearStr, monthStr, dayStr] = trimmed.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const canonical = `${yearStr}-${monthStr}-${dayStr}`;
  return {
    start: `${canonical}T00:00:00`,
    end: `${canonical}T23:59:59.999`,
  };
}

function normalizeTherapistId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeReason(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return undefined;
}

function parseSessionRecords(data: SessionRecord[] | null): { id: string; status: string }[] {
  if (!data) {
    return [];
  }

  const parsed: { id: string; status: string }[] = [];
  for (const record of data) {
    const id = typeof record.id === "string" ? record.id : record.id != null ? String(record.id) : "";
    const status = typeof record.status === "string" ? record.status : record.status != null ? String(record.status) : "";

    if (id.length === 0) {
      continue;
    }

    parsed.push({ id, status });
  }

  return parsed;
}

function summarizeCancellation(
  matched: { id: string; status: string }[],
  cancelledIds: string[],
): SessionCancellationSummary {
  const cancelledSet = new Set(cancelledIds);
  const alreadyCancelled: string[] = [];

  for (const session of matched) {
    if (session.status === "cancelled" && !cancelledSet.has(session.id)) {
      alreadyCancelled.push(session.id);
    }
  }

  return {
    cancelledCount: cancelledIds.length,
    alreadyCancelledCount: alreadyCancelled.length,
    totalCount: matched.length,
    cancelledSessionIds: cancelledIds,
    alreadyCancelledSessionIds: alreadyCancelled,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const user = await ensureAuthenticated(req);
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedKey = idempotencyKey.length > 0 ? idempotencyKey : null;
    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);

    if (normalizedKey) {
      const existing = await idempotencyService.find(normalizedKey, "sessions-cancel");
      if (existing) {
        return jsonResponse(
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey },
        );
      }
    }

    const respond = async (body: Record<string, unknown>, status: number = 200) => {
      if (!normalizedKey) {
        return jsonResponse(body, status);
      }

      try {
        await idempotencyService.persist(normalizedKey, "sessions-cancel", body, status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse({ success: false, error: error.message }, 409);
        }
        throw error;
      }

      return jsonResponse(body, status, { "Idempotency-Key": normalizedKey });
    };

    const payload = await req.json() as CancelPayload;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("sessions-cancel profile lookup error", profileError);
      return respond({
        success: false,
        error: profileError.message ?? "Failed to determine user role",
      }, 500);
    }

    const profileRecord = profile as Record<string, unknown> | null;
    const role = normalizeRole(profileRecord?.role);
    const isAdmin = isAdminRole(role);
    const isTherapist = isTherapistRole(role);

    if (!isAdmin && !isTherapist) {
      return respond({ success: false, error: "Forbidden" }, 403);
    }

    if (payload?.hold_key) {
      const holdKey = typeof payload.hold_key === "string" ? payload.hold_key.trim() : "";
      if (holdKey.length === 0) {
        return respond({ success: false, error: "Missing required fields" }, 400);
      }

      let holdQuery = supabaseAdmin
        .from("session_holds")
        .delete()
        .eq("hold_key", holdKey);

      if (isTherapist) {
        holdQuery = holdQuery.eq("therapist_id", user.id);
      }

      const { data, error } = await holdQuery
        .select("id, hold_key, therapist_id, client_id, start_time, end_time, expires_at")
        .maybeSingle();

      if (error) {
        console.error("sessions-cancel delete hold error", error);
        return respond({ success: false, error: error.message ?? "Failed to cancel hold" }, 500);
      }

      if (!data) {
        return respond({ success: true, data: { released: false } });
      }

      const hold = data as Record<string, unknown>;

      return respond({
        success: true,
        data: {
          released: true,
          hold: {
            id: String(hold.id ?? ""),
            holdKey: String(hold.hold_key ?? ""),
            therapistId: String(hold.therapist_id ?? ""),
            clientId: String(hold.client_id ?? ""),
            startTime: String(hold.start_time ?? ""),
            endTime: String(hold.end_time ?? ""),
            expiresAt: String(hold.expires_at ?? ""),
          },
        },
      });
    }

    const sessionIds = normalizeSessionIds(payload?.session_ids);
    const dateRange = buildDateRange(payload?.date);
    const therapistId = normalizeTherapistId(payload?.therapist_id);
    const reason = normalizeReason(payload?.reason);

    if (isTherapist && therapistId && therapistId !== user.id) {
      return respond({ success: false, error: "Forbidden" }, 403);
    }

    if (isTherapist && sessionIds.length > 0) {
      const { data: ownershipData, error: ownershipError } = await supabaseAdmin
        .from("sessions")
        .select("id")
        .eq("therapist_id", user.id)
        .in("id", sessionIds);

      if (ownershipError) {
        console.error("sessions-cancel ownership check error", ownershipError);
        return respond({
          success: false,
          error: ownershipError.message ?? "Failed to verify sessions",
        }, 500);
      }

      const ownedIds = new Set(
        parseSessionRecords(ownershipData as SessionRecord[] | null).map((session) => session.id),
      );

      if (ownedIds.size !== sessionIds.length) {
        return respond({ success: false, error: "Forbidden" }, 403);
      }
    }

    if (sessionIds.length === 0 && !dateRange) {
      return respond({ success: false, error: "Must provide session_ids or date" }, 400);
    }

    const targetTherapistId = isTherapist ? user.id : therapistId;

    let selectQuery = supabaseAdmin.from("sessions");
    if (sessionIds.length > 0) {
      selectQuery = selectQuery.in("id", sessionIds);
    }
    if (dateRange) {
      selectQuery = selectQuery
        .gte("start_time", dateRange.start)
        .lt("start_time", dateRange.end);
    }
    if (targetTherapistId) {
      selectQuery = selectQuery.eq("therapist_id", targetTherapistId);
    }

    const { data: matchedSessions, error: fetchError } = await selectQuery.select("id, status");

    if (fetchError) {
      console.error("sessions-cancel fetch sessions error", fetchError);
      return respond({ success: false, error: fetchError.message ?? "Failed to load sessions" }, 500);
    }

    const parsedSessions = parseSessionRecords(matchedSessions as SessionRecord[] | null);

    if (parsedSessions.length === 0) {
      const summary = summarizeCancellation(parsedSessions, []);
      return respond({ success: true, data: summary });
    }

    const cancellableIds = parsedSessions
      .filter((session) => session.status !== "cancelled")
      .map((session) => session.id);

    let cancelledIds: string[] = [];

    if (cancellableIds.length > 0) {
      const updates: Record<string, unknown> = { status: "cancelled", updated_by: user.id };
      if (reason !== undefined) {
        updates.notes = reason;
      }

      let updateQuery = supabaseAdmin
        .from("sessions")
        .update(updates)
        .in("id", cancellableIds);

      if (targetTherapistId) {
        updateQuery = updateQuery.eq("therapist_id", targetTherapistId);
      }

      const { data: updated, error: updateError } = await updateQuery.select("id");

      if (updateError) {
        console.error("sessions-cancel update error", updateError);
        return respond({ success: false, error: updateError.message ?? "Failed to cancel sessions" }, 500);
      }

      if (Array.isArray(updated)) {
        cancelledIds = updated
          .map((row) => (typeof row.id === "string" ? row.id : row.id != null ? String(row.id) : ""))
          .filter((id) => id.length > 0);
      }
    }

    const summary = summarizeCancellation(parsedSessions, cancelledIds);
    return respond({ success: true, data: summary });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-cancel error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
