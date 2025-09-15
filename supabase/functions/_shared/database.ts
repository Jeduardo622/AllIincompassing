import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);
export function createRequestClient(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization") || "";
  return createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }});
}
