import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

type ConflictDimension = "therapist" | "client";

interface OverlapContext {
  readonly startTime: string;
  readonly endTime: string;
  readonly therapistId?: string | null;
  readonly clientId?: string | null;
}

const ISO_NOW = () => new Date().toISOString();

const DIMENSION_COLUMN: Record<ConflictDimension, string> = {
  therapist: "therapist_id",
  client: "client_id",
};

async function findEarliestHoldExpiration(
  client: SupabaseClient,
  dimension: ConflictDimension,
  identifier: string,
  context: OverlapContext,
): Promise<string | null> {
  const { data, error } = await client
    .from("session_holds")
    .select("expires_at")
    .eq(DIMENSION_COLUMN[dimension], identifier)
    .gt("end_time", context.startTime)
    .lt("start_time", context.endTime)
    .gt("expires_at", ISO_NOW())
    .order("expires_at", { ascending: true })
    .limit(1);

  if (error) {
    console.warn("resolveRetryAfter(session_holds) failed", {
      dimension,
      identifier,
      error: error.message ?? "unknown",
    });
    return null;
  }

  const [first] = data ?? [];
  return typeof first?.expires_at === "string" ? first.expires_at : null;
}

async function findEarliestSessionEnd(
  client: SupabaseClient,
  dimension: ConflictDimension,
  identifier: string,
  context: OverlapContext,
): Promise<string | null> {
  const { data, error } = await client
    .from("sessions")
    .select("end_time")
    .neq("status", "cancelled")
    .eq(DIMENSION_COLUMN[dimension], identifier)
    .gt("end_time", context.startTime)
    .lt("start_time", context.endTime)
    .order("end_time", { ascending: true })
    .limit(1);

  if (error) {
    console.warn("resolveRetryAfter(sessions) failed", {
      dimension,
      identifier,
      error: error.message ?? "unknown",
    });
    return null;
  }

  const [first] = data ?? [];
  return typeof first?.end_time === "string" ? first.end_time : null;
}

function chooseEarliestIso(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return valid.length > 0 ? valid[0] : null;
}

export async function resolveSchedulingRetryAfter(
  client: SupabaseClient,
  context: OverlapContext,
  dimensions: ConflictDimension[],
): Promise<{ retryAfterIso: string | null; retryAfterSeconds: number | null }> {
  const timestamps: string[] = [];

  await Promise.all(dimensions.map(async (dimension) => {
    const identifier = dimension === "therapist" ? context.therapistId : context.clientId;
    if (!identifier) return;

    const [holdExpiration, sessionEnd] = await Promise.all([
      findEarliestHoldExpiration(client, dimension, identifier, context),
      findEarliestSessionEnd(client, dimension, identifier, context),
    ]);

    if (holdExpiration) timestamps.push(holdExpiration);
    if (sessionEnd) timestamps.push(sessionEnd);
  }));

  const retryAfterIso = chooseEarliestIso(timestamps);
  if (!retryAfterIso) {
    return { retryAfterIso: null, retryAfterSeconds: null };
  }

  const millis = Date.parse(retryAfterIso) - Date.now();
  const retryAfterSeconds = Number.isFinite(millis) ? Math.max(0, Math.ceil(millis / 1000)) : null;

  return { retryAfterIso, retryAfterSeconds };
}
