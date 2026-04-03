import { getOptionalServerEnv, getRequiredServerEnv } from "../env";

const FORWARDED_HEADER_KEYS = [
  "Idempotency-Key",
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const resolveRuntimeAnonKey = (): string | undefined => {
  const explicitCandidates = [
    getOptionalServerEnv("SUPABASE_PUBLISHABLE_KEY"),
    getOptionalServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
    getOptionalServerEnv("SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
    getOptionalServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
    getOptionalServerEnv("SUPABASE_ANON_KEY"),
    getOptionalServerEnv("VITE_SUPABASE_ANON_KEY"),
  ];
  const explicit = explicitCandidates.find((value) => typeof value === "string" && value.trim().length > 0);
  if (explicit) {
    return explicit.trim();
  }
  const generatedPublishable = Object.entries(process.env).find(([key, value]) =>
    key.includes("PUBLISHABLE") &&
    key.endsWith("_SUPABASE_ANON_KEY") &&
    typeof value === "string" &&
    value.trim().length > 0
  )?.[1];
  return typeof generatedPublishable === "string" ? generatedPublishable.trim() : undefined;
};

export const getEdgeAuthorityBaseUrl = (): string => {
  const explicit = getOptionalServerEnv("SUPABASE_EDGE_URL") ?? getOptionalServerEnv("VITE_SUPABASE_EDGE_URL");
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const supabaseUrl =
    getOptionalServerEnv("SUPABASE_URL") ||
    getOptionalServerEnv("SUPABASE_DATABASE_URL") ||
    getRequiredServerEnv("VITE_SUPABASE_URL");
  return `${normalizeBaseUrl(supabaseUrl)}/functions/v1`;
};

export const getApiAuthorityMode = (): "edge" | "legacy" => {
  const configured = getOptionalServerEnv("API_AUTHORITY_MODE")?.toLowerCase();
  if (configured === "edge") {
    return "edge";
  }
  if (configured === "legacy") {
    return "legacy";
  }
  const nodeEnv = (getOptionalServerEnv("NODE_ENV") ?? "").toLowerCase();
  return nodeEnv === "production" ? "edge" : "legacy";
};

const buildForwardHeaders = (request: Request, accessToken: string | null): Headers => {
  const headers = new Headers(JSON_HEADERS);
  const authHeader = accessToken
    ? `Bearer ${accessToken}`
    : request.headers.get("Authorization");
  const apiKey =
    request.headers.get("apikey") ??
    resolveRuntimeAnonKey();

  if (authHeader) {
    headers.set("Authorization", authHeader);
  }
  if (apiKey && apiKey.trim().length > 0) {
    headers.set("apikey", apiKey.trim());
  }

  for (const key of FORWARDED_HEADER_KEYS) {
    const value = request.headers.get(key);
    if (value && value.trim().length > 0) {
      headers.set(key, value);
    }
  }

  return headers;
};

const readForwardBody = async (request: Request): Promise<string | undefined> => {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return undefined;
  }
  const text = await request.text();
  return text.length > 0 ? text : undefined;
};

export async function proxyToEdgeAuthority(request: Request, options: {
  functionName: string;
  accessToken?: string | null;
  method?: "GET" | "POST";
  body?: string;
}): Promise<Response> {
  const method = options.method ?? (request.method === "GET" ? "GET" : "POST");
  const baseUrl = getEdgeAuthorityBaseUrl();
  const incomingUrl = new URL(request.url);
  const url = new URL(`${baseUrl}/${options.functionName}`);
  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const headers = buildForwardHeaders(request, options.accessToken ?? null);
  const body = options.body ?? (await readForwardBody(request));

  return fetch(url.toString(), {
    method,
    headers,
    body,
  });
}

