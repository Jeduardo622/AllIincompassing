import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createMcpHandler } from "./mcpHandler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const DEFAULT_ALLOWED_ORIGINS = [
  "https://app.allincompassing.ai",
  "https://preview.allincompassing.ai",
  "https://staging.allincompassing.ai",
  "http://localhost:3000",
  "http://localhost:5173",
] as const;

const parseAllowedOrigins = () =>
  (Deno.env.get("MCP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const allowedOrigins = new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...parseAllowedOrigins()]);
const fallbackAllowedOrigin = DEFAULT_ALLOWED_ORIGINS[0] ?? "https://app.allincompassing.ai";

function audit(event: string, details: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    details,
  };
  console.log(JSON.stringify(payload));
}

const createRequestSupabaseClient = (token: string) =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

const handler = createMcpHandler({
  supabaseUrl: SUPABASE_URL,
  allowedOrigins,
  fallbackAllowedOrigin,
  audit,
  getUserId: async (token: string) => {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  },
  rpc: async (token: string, name: string, args: Record<string, unknown>) => {
    const requestSupabase = createRequestSupabaseClient(token);
    const { data, error } = await requestSupabase.rpc(name, args);
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, data };
  },
});

Deno.serve(handler);
