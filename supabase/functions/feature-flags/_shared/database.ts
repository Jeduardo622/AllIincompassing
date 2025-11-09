// deno-lint-ignore-file no-import-prefix
type SupabaseModule = typeof import("npm:@supabase/supabase-js@2.50.0");
type SupabaseClient = import("npm:@supabase/supabase-js@2.50.0").SupabaseClient;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

let cachedModule: SupabaseModule | null = null;
let cachedAdmin: SupabaseClient | null = null;

export const configureSupabaseModule = (module: SupabaseModule): void => {
  cachedModule = module;
  cachedAdmin = null;
};

const ensureModule = (): SupabaseModule => {
  if (!cachedModule) {
    throw new Error("Supabase module has not been configured. Call configureSupabaseModule first.");
  }
  return cachedModule;
};

export const getSupabaseAdmin = (): SupabaseClient => {
  if (!cachedAdmin) {
    const module = ensureModule();
    cachedAdmin = module.createClient(SUPABASE_URL, SERVICE_KEY);
  }
  return cachedAdmin;
};

export const createRequestClient = (req: Request): SupabaseClient => {
  const module = ensureModule();
  const auth = req.headers.get("Authorization") || "";
  return module.createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
};
