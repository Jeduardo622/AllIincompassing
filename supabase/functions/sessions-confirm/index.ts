import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ConfirmPayload {
  hold_key: string;
  session: Record<string, unknown>;
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

    const payload = await req.json() as ConfirmPayload;
    if (!payload?.hold_key || !payload?.session) {
      return jsonResponse({ success: false, error: "Missing required fields" }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc("confirm_session_hold", {
      p_hold_key: payload.hold_key,
      p_session: payload.session,
    });

    if (error) {
      console.error("confirm_session_hold error", error);
      return jsonResponse({ success: false, error: error.message ?? "Failed to confirm session" }, 500);
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
      };
      const status = statusMap[data?.error_code as string] ?? 409;
      return jsonResponse({
        success: false,
        error: data?.error_message ?? "Unable to confirm session",
        code: data?.error_code,
      }, status);
    }

    const session = data.session as Record<string, unknown> | undefined;
    if (!session) {
      return jsonResponse({ success: false, error: "Session response missing" }, 500);
    }

    return jsonResponse({ success: true, data: { session } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-confirm error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
