import { resolveSupabasePublishableKeyFromEnv } from "./supabaseEnv.ts";

/**
 * Bearer token from Authorization, else X-Supabase-Authorization (duplicate header path).
 * Ignores empty payloads after the Bearer prefix so a bad primary header cannot mask a valid fallback.
 */
export function extractBearerToken(req: Request): string | null {
  const fromBearerHeader = (value: string | null): string | null => {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!/^Bearer\s+/i.test(trimmed)) {
      return null;
    }
    const token = trimmed.replace(/^Bearer\s+/i, "").trim();
    return token.length > 0 ? token : null;
  };

  return (
    fromBearerHeader(req.headers.get("Authorization")) ??
    fromBearerHeader(req.headers.get("X-Supabase-Authorization"))
  );
}

/**
 * Prefer request apikey (browser /api/dashboard forwards runtime anon) over edge env so JWT + anon
 * stay on the same Supabase project when operator env drifts from the live SPA config.
 */
export function resolvePublishableApiKeyForRequest(req: Request): string {
  const fromHeader = req.headers.get("apikey")?.trim();
  if (fromHeader && fromHeader.length > 0) {
    return fromHeader;
  }
  return resolveSupabasePublishableKeyFromEnv();
}

export function resolveBearerAuthorizationHeader(req: Request): string {
  const token = extractBearerToken(req);
  return token ? `Bearer ${token}` : "";
}
