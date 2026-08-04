const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PHASE2_KONG_ORIGIN = "http://supabase_kong_alliincompassing:8000";
const PHASE2_FUNCTION_URLS = new Set([
  "http://agent-work-items:8000/agent-work-items",
  "http://agent-work-runner:8000/agent-work-runner",
  "http://agent-work-sweeper:8000/agent-work-sweeper",
]);

export const PHASE2_CONTAINER_FLAG = "AGENT_WORK_PHASE2_CONTAINER";

export const isPhase2ContainerMode = (env = process.env) =>
  env?.[PHASE2_CONTAINER_FLAG]?.trim() === "1";

const parseUrl = (value, name) => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
};

const hasCleanAuthorityAndOriginPath = (parsed) =>
  parsed.username === "" &&
  parsed.password === "" &&
  parsed.search === "" &&
  parsed.hash === "" &&
  parsed.pathname === "/";

export const assertLocalSupabaseHttpUrl = (
  value,
  name,
  env = process.env,
) => {
  const parsed = parseUrl(value, name);
  const cleanHttpOrigin = parsed.protocol === "http:" &&
    hasCleanAuthorityAndOriginPath(parsed);
  if (cleanHttpOrigin && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
  if (
    cleanHttpOrigin &&
    isPhase2ContainerMode(env) &&
    parsed.origin === PHASE2_KONG_ORIGIN
  ) {
    return parsed;
  }
  throw new Error(`${name} must use an exact local Supabase HTTP origin.`);
};

export const assertLocalPostgresUrl = (
  value,
  name,
  env = process.env,
) => {
  const parsed = parseUrl(value, name);
  const cleanDatabaseUrl =
    new Set(["postgres:", "postgresql:"]).has(parsed.protocol) &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname === "/postgres";
  if (cleanDatabaseUrl && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
  if (
    cleanDatabaseUrl &&
    isPhase2ContainerMode(env) &&
    parsed.protocol === "postgresql:" &&
    parsed.hostname.toLowerCase() === "supabase_db_alliincompassing" &&
    parsed.port === "5432" &&
    parsed.username === "postgres" &&
    parsed.password === "postgres"
  ) {
    return parsed;
  }
  throw new Error(`${name} must use an exact local Postgres endpoint.`);
};

export const assertExactPhase2FunctionUrl = (
  value,
  name,
  env = process.env,
) => {
  if (!isPhase2ContainerMode(env)) {
    throw new Error(`${name} requires exact Phase2 container mode.`);
  }
  const parsed = parseUrl(value, name);
  const normalized = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  if (
    parsed.protocol === "http:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    PHASE2_FUNCTION_URLS.has(normalized)
  ) {
    return new URL(normalized);
  }
  throw new Error(`${name} must use an exact Phase2 function service URL.`);
};

export const assertExactLocalRuntimeUrl = assertExactPhase2FunctionUrl;
