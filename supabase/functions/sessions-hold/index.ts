import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HoldPayload {
  therapist_id: string;
  client_id: string;
  start_time: string;
  end_time: string;
  session_id?: string | null;
  hold_seconds?: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

async function ensureAuthenticated(req: Request) {
  const client = createRequestClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    await ensureAuthenticated(req);

    const payload = await req.json() as HoldPayload;
    if (!payload?.therapist_id || !payload?.client_id || !payload?.start_time || !payload?.end_time) {
      return jsonResponse({ success: false, error: "Missing required fields" }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc("acquire_session_hold", {
      p_therapist_id: payload.therapist_id,
      p_client_id: payload.client_id,
      p_start_time: payload.start_time,
      p_end_time: payload.end_time,
      p_session_id: payload.session_id ?? null,
      p_hold_seconds: payload.hold_seconds ?? 300,
    });

    if (error) {
      console.error("acquire_session_hold error", error);
      return jsonResponse({ success: false, error: error.message ?? "Failed to create hold" }, 500);
    }

    if (!data?.success) {
      const statusMap: Record<string, number> = {
        INVALID_RANGE: 400,
        HOLD_EXISTS: 409,
        THERAPIST_CONFLICT: 409,
        CLIENT_CONFLICT: 409,
      };
      const status = statusMap[data?.error_code as string] ?? 409;
      return jsonResponse({
        success: false,
        error: data?.error_message ?? "Unable to hold session",
        code: data?.error_code,
      }, status);
    }

    const hold = data.hold as Record<string, string> | undefined;
    if (!hold) {
      return jsonResponse({ success: false, error: "Hold response missing" }, 500);
    }

    return jsonResponse({
      success: true,
      data: {
        holdKey: hold.hold_key,
        holdId: hold.id,
        expiresAt: hold.expires_at,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-hold error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
