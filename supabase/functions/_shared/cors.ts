const DEFAULT_DEV_ORIGIN = "http://localhost:5173";
const DEFAULT_PROD_ORIGIN = "https://velvety-cendol-dae4d6.netlify.app";

export function resolveAllowedOrigin(): string {
  const configuredOrigins = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (configuredOrigins) {
    const origin = configuredOrigins
      .split(",")
      .map((entry) => entry.trim())
      .find(Boolean);
    if (origin) return origin;
  }

  const appEnv = (Deno.env.get("APP_ENV") ?? Deno.env.get("DENO_ENV") ?? "production").toLowerCase();
  const isLocal = appEnv === "development" || appEnv === "local";
  return isLocal ? DEFAULT_DEV_ORIGIN : DEFAULT_PROD_ORIGIN;
}

