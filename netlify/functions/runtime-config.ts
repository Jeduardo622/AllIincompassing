import { getRuntimeSupabaseConfig } from "../../src/server/runtimeConfig";
import { corsHeadersForOrigin, getDefaultAllowedOrigin, resolveAllowedOriginValue } from "../../src/server/corsPolicy";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const toCorsHeaders = (origin: string | undefined): Record<string, string> => {
  const resolved = resolveAllowedOriginValue(origin ?? null) ?? getDefaultAllowedOrigin();
  return corsHeadersForOrigin(resolved);
};

export const handler = async (event: { headers?: Record<string, string | undefined> }) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  const corsHeaders = toCorsHeaders(origin);

  try {
    const config = getRuntimeSupabaseConfig();
    return {
      statusCode: 200,
      headers: {
        ...JSON_HEADERS,
        ...corsHeaders,
      },
      body: JSON.stringify(config),
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Missing required environment variables for runtime config";
    return {
      statusCode: 500,
      headers: {
        ...JSON_HEADERS,
        ...corsHeaders,
      },
      body: JSON.stringify({ error: message }),
    };
  }
};

