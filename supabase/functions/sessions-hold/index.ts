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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HoldOccurrencePayload {
  start_time: string;
  end_time: string;
  start_time_offset_minutes: number;
  end_time_offset_minutes: number;
  time_zone?: string;
}

interface HoldPayload extends TimezoneValidationPayload {
  therapist_id: string;
  client_id: string;
  session_id?: string | null;
  hold_seconds?: number;
  occurrences?: HoldOccurrencePayload[];
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
      const existing = await idempotencyService.find(normalizedKey, "sessions-hold");
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
        await idempotencyService.persist(normalizedKey, "sessions-hold", body, status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse(
            { success: false, error: error.message },
            409,
          );
        }
        throw error;
      }

      return jsonResponse(body, status, { "Idempotency-Key": normalizedKey });
    };

    const payload = await req.json() as HoldPayload;
    if (!payload?.therapist_id || !payload?.client_id || !payload?.start_time || !payload?.end_time) {
      return respond({ success: false, error: "Missing required fields" }, 400);
    }

    const authorization = await evaluateTherapistAuthorization(requestClient, payload.therapist_id);
    if (!authorization.ok) {
      return respond(authorization.failure.body, authorization.failure.status);
    }

    const occurrencePayloads = Array.isArray(payload.occurrences) && payload.occurrences.length > 0
      ? payload.occurrences
      : [payload];

    for (const occurrence of occurrencePayloads) {
      const offsetValidation = validateTimezonePayload({
        start_time: occurrence.start_time,
        end_time: occurrence.end_time,
        start_time_offset_minutes: occurrence.start_time_offset_minutes,
        end_time_offset_minutes: occurrence.end_time_offset_minutes,
        time_zone: occurrence.time_zone ?? payload.time_zone,
      });

      if (!offsetValidation.ok) {
        return respond({ success: false, error: offsetValidation.message }, 400);
      }
    }

    const createdHolds: Array<{ hold_key: string; id: string; start_time: string; end_time: string; expires_at: string; }> = [];

    for (const occurrence of occurrencePayloads) {
      const { data, error } = await supabaseAdmin.rpc("acquire_session_hold", {
        p_therapist_id: payload.therapist_id,
        p_client_id: payload.client_id,
        p_start_time: occurrence.start_time,
        p_end_time: occurrence.end_time,
        p_session_id: payload.session_id ?? null,
        p_hold_seconds: payload.hold_seconds ?? 300,
        p_actor_id: user.id,
      });

      if (error) {
        console.error("acquire_session_hold error", error);
        if (createdHolds.length > 0) {
          await supabaseAdmin
            .from("session_holds")
            .delete()
            .in("hold_key", createdHolds.map((hold) => hold.hold_key));
        }
        return respond({ success: false, error: error.message ?? "Failed to create hold" }, 500);
      }

      if (!data?.success) {
        const statusMap: Record<string, number> = {
          INVALID_RANGE: 400,
          HOLD_EXISTS: 409,
          THERAPIST_CONFLICT: 409,
          CLIENT_CONFLICT: 409,
          FORBIDDEN: 403,
        };
        const status = statusMap[data?.error_code as string] ?? 409;

        if (createdHolds.length > 0) {
          await supabaseAdmin
            .from("session_holds")
            .delete()
            .in("hold_key", createdHolds.map((hold) => hold.hold_key));
        }

        return respond({
          success: false,
          error: data?.error_message ?? "Unable to hold session",
          code: data?.error_code,
        }, status);
      }

      const hold = data.hold as Record<string, string> | undefined;
      if (!hold) {
        if (createdHolds.length > 0) {
          await supabaseAdmin
            .from("session_holds")
            .delete()
            .in("hold_key", createdHolds.map((created) => created.hold_key));
        }
        return respond({ success: false, error: "Hold response missing" }, 500);
      }

      createdHolds.push(hold as {
        hold_key: string;
        id: string;
        start_time: string;
        end_time: string;
        expires_at: string;
      });
    }

    const [primaryHold] = createdHolds;
    if (!primaryHold) {
      return respond({ success: false, error: "Failed to create hold" }, 500);
    }

    return respond({
      success: true,
      data: {
        holdKey: primaryHold.hold_key,
        holdId: primaryHold.id,
        expiresAt: primaryHold.expires_at,
        holds: createdHolds.map((hold) => ({
          holdKey: hold.hold_key,
          holdId: hold.id,
          startTime: hold.start_time,
          endTime: hold.end_time,
          expiresAt: hold.expires_at,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-hold error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
