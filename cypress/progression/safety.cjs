const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const OPT_IN = "YES_LOCAL_SYNTHETIC_ONLY";
const PROJECT_ID = "AllIincompassing";

const refuse = (reason) => {
  throw new Error(`Refusing progression Cypress harness: ${reason}`);
};

const parseUrl = (raw, label, protocols) => {
  if (!raw) refuse(`${label} is required`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    refuse(`${label} is invalid`);
  }
  if (!protocols.has(parsed.protocol)) refuse(`${label} uses a forbidden protocol`);
  if (!LOCAL_HOSTS.has(parsed.hostname)) refuse(`${label} must use a loopback host`);
  if (parsed.username || parsed.password) refuse(`${label} must not contain embedded credentials`);
  return parsed;
};

function validateProgressionHarnessEnvironment(env) {
  if (env.PROGRESSION_E2E_LOCAL_OPT_IN !== OPT_IN) refuse("explicit local-only opt-in is missing");
  if (env.PROGRESSION_E2E_PROJECT_ID !== PROJECT_ID) refuse("project identifier is not allowlisted");

  const baseUrl = parseUrl(env.CYPRESS_BASE_URL, "CYPRESS_BASE_URL", new Set(["http:"]));
  const supabaseUrl = parseUrl(env.SUPABASE_URL, "SUPABASE_URL", new Set(["http:"]));

  if (!env.SUPABASE_DB_URL) refuse("SUPABASE_DB_URL is required");
  let databaseUrl;
  try {
    databaseUrl = new URL(env.SUPABASE_DB_URL);
  } catch {
    refuse("SUPABASE_DB_URL is invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) refuse("SUPABASE_DB_URL uses a forbidden protocol");
  if (!LOCAL_HOSTS.has(databaseUrl.hostname)) refuse("SUPABASE_DB_URL must use a loopback host");
  if (databaseUrl.pathname !== "/postgres") refuse("SUPABASE_DB_URL must target the local postgres database");

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
    databaseUrl: env.SUPABASE_DB_URL,
    projectId: PROJECT_ID,
  };
}

module.exports = { validateProgressionHarnessEnvironment };
