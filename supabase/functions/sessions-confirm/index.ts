import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";
import {
  validateTimezonePayload,
  type TimezoneValidationPayload,
} from "../_shared/timezone.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { evaluateTherapistAuthorization } from "../_shared/authorization.ts";
import { recordSessionAuditEvent } from "../_shared/audit.ts";
import { resolveSchedulingRetryAfter } from "../_shared/retry-after.ts";
import { orchestrateScheduling } from "../_shared/scheduling-orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id, x-correlation-id, x-agent-operation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ConfirmOccurrencePayload
  extends Pick<TimezoneValidationPayload, "start_time_offset_minutes" | "end_time_offset_minutes" | "time_zone"> {
  hold_key: string;
  session: Record<string, unknown>;
}

interface ConfirmPayload
  extends Pick<TimezoneValidationPayload, "start_time_offset_minutes" | "end_time_offset_minutes" | "time_zone"> {
  hold_key: string;
  session: Record<string, unknown>;
  occurrences?: ConfirmOccurrencePayload[];
}

const conflictDimensions = {
  THERAPIST_CONFLICT: ["therapist"] as const,
  CLIENT_CONFLICT: ["client"] as const,
};

type ConflictCode = keyof typeof conflictDimensions;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const requestClient = createRequestClient(req);
    const user = await getUserOrThrow(requestClient);
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedKey = idempotencyKey.length > 0 ? idempotencyKey : null;
    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);

    if (normalizedKey) {
      const existing = await idempotencyService.find(normalizedKey, "sessions-confirm");
      if (existing) {
        return jsonResponse(
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey },
        );
      }
    }

    const respond = async (
      body: Record<string, unknown>,
      status: number = 200,
      headers: Record<string, string> = {},
    ) => {
      if (!normalizedKey) {
        return jsonResponse(body, status, headers);
      }

      try {
        await idempotencyService.persist(normalizedKey, "sessions-confirm", body, status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse(
            { success: false, error: error.message },
            409,
          );
        }
        throw error;
      }

      return jsonResponse(body, status, { ...headers, "Idempotency-Key": normalizedKey });
    };

    const payload = await req.json() as ConfirmPayload;
    if (!payload?.hold_key || !payload?.session) {
      return respond({ success: false, error: "Missing required fields" }, 400);
    }

    const sessionData = payload.session as { start_time?: unknown; end_time?: unknown };
    if (typeof sessionData.start_time !== "string" || typeof sessionData.end_time !== "string") {
      return respond({ success: false, error: "Session start_time or end_time missing" }, 400);
    }

    const occurrencePayloads = Array.isArray(payload.occurrences) && payload.occurrences.length > 0
      ? payload.occurrences
      : [{
          hold_key: payload.hold_key,
          session: payload.session,
          start_time_offset_minutes: payload.start_time_offset_minutes,
          end_time_offset_minutes: payload.end_time_offset_minutes,
          time_zone: payload.time_zone,
        }];

    for (const occurrence of occurrencePayloads) {
      const occurrenceSession = occurrence.session as { start_time?: unknown; end_time?: unknown };
      if (
        typeof occurrenceSession.start_time !== "string" ||
        typeof occurrenceSession.end_time !== "string"
      ) {
        return respond({ success: false, error: "Session start_time or end_time missing" }, 400);
      }

      const offsetValidation = validateTimezonePayload({
        start_time: occurrenceSession.start_time,
        end_time: occurrenceSession.end_time,
        start_time_offset_minutes: occurrence.start_time_offset_minutes,
        end_time_offset_minutes: occurrence.end_time_offset_minutes,
        time_zone: occurrence.time_zone ?? payload.time_zone,
      });

      if (!offsetValidation.ok) {
        return respond({ success: false, error: offsetValidation.message }, 400);
      }
    }

    const uniqueHoldKeys = Array.from(
      new Set(occurrencePayloads.map((occurrence) => occurrence.hold_key).filter(Boolean)),
    );

    if (uniqueHoldKeys.length === 0) {
      return respond({ success: false, error: "Hold key is required" }, 400);
    }

    const { data: holdRecords, error: holdFetchError } = await supabaseAdmin
      .from("session_holds")
      .select("hold_key, therapist_id, client_id, start_time, end_time")
      .in("hold_key", uniqueHoldKeys);

    if (holdFetchError) {
      console.error("Failed to load session holds for authorization", holdFetchError);
      return respond({ success: false, error: "Authorization lookup failed" }, 500);
    }

    const holdAuthorizationMap = new Map<string, {
      therapist_id: string;
      client_id: string;
      start_time: string;
      end_time: string;
    }>();
    if (Array.isArray(holdRecords)) {
      for (const record of holdRecords) {
        if (record?.hold_key && record?.therapist_id) {
          holdAuthorizationMap.set(record.hold_key, {
            therapist_id: record.therapist_id as string,
            client_id: record.client_id as string,
            start_time: record.start_time as string,
            end_time: record.end_time as string,
          });
        }
      }
    }

    const checkedTherapists = new Set<string>();
    for (const holdKey of uniqueHoldKeys) {
      const target = holdAuthorizationMap.get(holdKey);
      if (!target) {
        continue;
      }

      if (checkedTherapists.has(target.therapist_id)) {
        continue;
      }

      const authorization = await evaluateTherapistAuthorization(requestClient, target.therapist_id);
      if (!authorization.ok) {
        return respond(authorization.failure.body, authorization.failure.status);
      }

      checkedTherapists.add(target.therapist_id);
    }

    const confirmedSessions: Record<string, unknown>[] = [];

    for (const occurrence of occurrencePayloads) {
      const { data, error } = await supabaseAdmin.rpc("confirm_session_hold", {
        p_hold_key: occurrence.hold_key,
        p_session: occurrence.session,
        p_actor_id: user.id,
      });

      if (error) {
        console.error("confirm_session_hold error", error);
        return respond({ success: false, error: error.message ?? "Failed to confirm session" }, 500);
      }

      if (!data?.success) {
        const statusMap: Record<string, number> = {
          MISSING_FIELDS: 400,
          INVALID_RANGE: 400,
          HOLD_MISMATCH: 409,
          CLIENT_MISMATCH: 409,
          THERAPIST_CONFLICT: 409,
          CLIENT_CONFLICT: 409,
          HOLD_NOT_FOUND: 410,
          HOLD_EXPIRED: 410,
          FORBIDDEN: 403,
        };
        const status = statusMap[data?.error_code as string] ?? 409;

        let headers: Record<string, string> = {};
        let retryAfterIso: string | null = null;
        const conflictCode = data?.error_code as ConflictCode | undefined;
        if (conflictCode && conflictDimensions[conflictCode]) {
          const holdContext = holdAuthorizationMap.get(occurrence.hold_key);
          if (holdContext) {
            const retry = await resolveSchedulingRetryAfter(
              supabaseAdmin,
              {
                startTime: holdContext.start_time,
                endTime: holdContext.end_time,
                therapistId: holdContext.therapist_id,
                clientId: holdContext.client_id,
              },
              conflictDimensions[conflictCode] as Array<"therapist" | "client">,
            );

            retryAfterIso = retry.retryAfterIso;
            if (retry.retryAfterSeconds !== null) {
              headers = { "Retry-After": retry.retryAfterSeconds.toString() };
            }
          }
        }

        const holdContext = holdAuthorizationMap.get(occurrence.hold_key);
        const orchestration = await orchestrateScheduling({
          req,
          workflow: "confirm",
          actorId: user.id,
          request: {
            therapistId: holdContext?.therapist_id ?? null,
            clientId: holdContext?.client_id ?? null,
            startTime: holdContext?.start_time ?? null,
            endTime: holdContext?.end_time ?? null,
            holdKey: occurrence.hold_key,
            idempotencyKey: normalizedKey,
            conflictCode: conflictCode ?? null,
            retryAfter: retryAfterIso,
          },
          authorization: { ok: true },
        });

        return respond({
          success: false,
          error: data?.error_message ?? "Unable to confirm session",
          code: data?.error_code,
          retryAfter: retryAfterIso,
          orchestration,
        }, status, headers);
      }

      const session = data.session as Record<string, unknown> | undefined;
      if (!session) {
        return respond({ success: false, error: "Session response missing" }, 500);
      }

      confirmedSessions.push(session);
    }

    const [primarySession] = confirmedSessions;
    if (!primarySession) {
      return respond({ success: false, error: "Session response missing" }, 500);
    }

    const rawDuration = primarySession["duration_minutes"];
    let roundedDuration: number | null = null;

    if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
      roundedDuration = rawDuration;
    } else if (typeof rawDuration === "string") {
      const trimmed = rawDuration.trim();
      if (trimmed.length > 0) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          roundedDuration = Math.round(parsed);
        }
      }
    }

    const normalizeSession = (record: Record<string, unknown>) => {
      if (roundedDuration === null) {
        return record;
      }

      return {
        ...record,
        duration_minutes: roundedDuration,
      };
    };

    await Promise.all(confirmedSessions.map(async (session, index) => {
      const sessionId = session?.id;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return;
      }

      const occurrence = occurrencePayloads[index] ?? occurrencePayloads[0];
      await recordSessionAuditEvent(supabaseAdmin, {
        sessionId,
        eventType: "session_confirmed",
        actorId: user.id,
        payload: {
          holdKey: occurrence?.hold_key,
          startTime: session?.start_time,
          endTime: session?.end_time,
          roundedDurationMinutes: roundedDuration,
          occurrenceIndex: index,
          occurrences: confirmedSessions.length,
        },
      });
    }));

    return respond({
      success: true,
      data: {
        session: normalizeSession(primarySession),
        sessions: confirmedSessions.map(normalizeSession),
        roundedDurationMinutes: roundedDuration,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-confirm error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
