import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, createPublicRoute, corsHeaders, RouteOptions, type UserContext } from "../_shared/auth-middleware.ts";
import { supabaseAdmin } from "../_shared/database.ts";

const FUNCTION_NAME = "admin-actions-retention";
const DEFAULT_RETENTION_DAYS = 365;
const BUCKET_NAME = "audit-exports";

type JsonRecord = Record<string, unknown>;

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function ensureBucket(db: SupabaseClient, bucket: string): Promise<void> {
  const { data: buckets, error: listError } = await db.storage.listBuckets();
  if (listError) throw new Error(`listBuckets failed: ${listError.message}`);
  if (buckets?.some(b => b.name === bucket)) return;
  const { error: createError } = await db.storage.createBucket(bucket, { public: false });
  if (createError) throw new Error(`createBucket failed: ${createError.message}`);
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function exportAndPrune({ days }: { days: number }): Promise<{ exportedKey: string; pruned: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  // Export rows older than cutoff to storage JSON
  const { data: rows, error: selectError } = await supabaseAdmin
    .from("admin_actions")
    .select("*")
    .lt("created_at", cutoffIso);
  if (selectError) throw new Error(`select admin_actions failed: ${selectError.message}`);

  await ensureBucket(supabaseAdmin, BUCKET_NAME);
  const key = `admin_actions_${formatDate(cutoff)}.json`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(key, new Blob([JSON.stringify(rows ?? [], null, 2)], { type: "application/json" }), { upsert: true });
  if (uploadError) throw new Error(`upload export failed: ${uploadError.message}`);

  // Prune via RPC (security definer)
  const { data: pruned, error: pruneError } = await supabaseAdmin.rpc("prune_admin_actions", { retention_days: days });
  if (pruneError) throw new Error(`prune_admin_actions failed: ${pruneError.message}`);
  return { exportedKey: key, pruned: pruned ?? 0 };
}

async function handler(_req: Request, _ctx: UserContext): Promise<Response> {
  try {
    const retentionEnv = Deno.env.get("ADMIN_ACTIONS_RETENTION_DAYS");
    const days = Math.max(1, Number(retentionEnv ?? DEFAULT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS);
    const result = await exportAndPrune({ days });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// Allow either super admins to invoke manually, or a cron token for automation
const CRON_TOKEN = Deno.env.get("ADMIN_RETENTION_TOKEN") ?? "";

export const cron = createPublicRoute(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = req.headers.get("x-cron-token") ?? "";
  if (!CRON_TOKEN || token !== CRON_TOKEN) return json(401, { error: "unauthorized" });
  try {
    const retentionEnv = Deno.env.get("ADMIN_ACTIONS_RETENTION_DAYS");
    const days = Math.max(1, Number(retentionEnv ?? DEFAULT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS);
    const result = await exportAndPrune({ days });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default createProtectedRoute(handler, RouteOptions.superAdmin);


