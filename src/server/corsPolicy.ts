import { getOptionalServerEnv } from "./env";

const STATIC_ALLOWED_ORIGINS = [
  "https://app.allincompassing.ai",
  "https://allincompassing.ai",
  "https://www.allincompassing.ai",
  "https://preview.allincompassing.ai",
  "https://staging.allincompassing.ai",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://localhost:3000",
  "http://localhost:5173",
] as const;

const parseConfiguredOrigins = (): string[] =>
  (getOptionalServerEnv("API_ALLOWED_ORIGINS") ?? getOptionalServerEnv("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

export const getAllowedOrigins = (): string[] => {
  const values = new Set<string>([...STATIC_ALLOWED_ORIGINS, ...parseConfiguredOrigins()]);
  return Array.from(values);
};

export const getDefaultAllowedOrigin = (): string => getAllowedOrigins()[0] ?? "https://app.allincompassing.ai";

export const resolveAllowedOriginValue = (origin: string | null): string | null => {
  if (!origin) {
    return getDefaultAllowedOrigin();
  }
  return getAllowedOrigins().includes(origin) ? origin : null;
};

export const corsHeadersForOrigin = (origin: string | null): Record<string, string> => {
  const resolvedOrigin = resolveAllowedOriginValue(origin) ?? getDefaultAllowedOrigin();
  return {
    "Access-Control-Allow-Origin": resolvedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key, x-request-id, x-correlation-id, x-agent-operation-id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };
};

