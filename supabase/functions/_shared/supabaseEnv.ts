/**
 * Resolve Supabase project URL and publishable (anon) key from Deno.env.
 * Keeps edge functions aligned with Netlify `edgeAuthority` / `database.ts` naming.
 */

export const resolveSupabaseUrlFromEnv = (): string => {
  const candidates = [
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("VITE_SUPABASE_URL"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
};

export const resolveSupabasePublishableKeyFromEnv = (): string => {
  const candidates = [
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
    Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    Deno.env.get("VITE_SUPABASE_ANON_KEY"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
};
