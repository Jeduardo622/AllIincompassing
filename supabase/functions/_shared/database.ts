import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { resolveSupabaseUrlFromEnv } from "./supabaseEnv.ts";
import { resolveBearerAuthorizationHeader, resolvePublishableApiKeyForRequest } from "./requestAuthHeaders.ts";

const SUPABASE_URL = resolveSupabaseUrlFromEnv();
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);
export function createRequestClient(req: Request): SupabaseClient {
  const auth = resolveBearerAuthorizationHeader(req);
  const anon = resolvePublishableApiKeyForRequest(req);
  return createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: auth } } });
}
