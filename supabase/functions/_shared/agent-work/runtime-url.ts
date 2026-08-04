export type AgentWorkSupabaseUrlOptions = {
  phase2Container?: boolean;
  hostedProjectRef?: string;
};

const HOSTED_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const PHASE2_KONG_ORIGIN = "http://supabase_kong_alliincompassing:8000";

function sanitizeInvalidConfigError(): Error {
  return new Error("Agent Work hosted project ref must be a 20-character lowercase alphanumeric value");
}

function sanitizeInvalidUrlError(): Error {
  return new Error("SUPABASE_URL must target the approved local Agent Work stack");
}

export function assertAgentWorkSupabaseUrl(
  value: string,
  options: AgentWorkSupabaseUrlOptions = {},
): string {
  const hostedProjectRef = options.hostedProjectRef?.trim() ?? "";
  if (hostedProjectRef.length > 0 && !HOSTED_PROJECT_REF_PATTERN.test(hostedProjectRef)) {
    throw sanitizeInvalidConfigError();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw sanitizeInvalidUrlError();
  }

  const cleanOrigin = url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname === "/";
  const loopback = url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  const exactPhase2Kong = options.phase2Container === true &&
    url.origin === PHASE2_KONG_ORIGIN &&
    url.protocol === "http:";
  const exactHostedOrigin = hostedProjectRef.length > 0 &&
    url.protocol === "https:" &&
    url.port === "" &&
    url.hostname === `${hostedProjectRef}.supabase.co`;

  if (!cleanOrigin || (!loopback && !exactPhase2Kong && !exactHostedOrigin)) {
    throw sanitizeInvalidUrlError();
  }

  return url.origin;
}
