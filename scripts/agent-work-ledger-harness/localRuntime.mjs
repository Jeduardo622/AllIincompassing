const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PHASE2_SERVICE_HOSTS = new Set([
  "agent-work-items",
  "agent-work-runner",
  "agent-work-sweeper",
]);

export const PHASE2_CONTAINER_FLAG = "AGENT_WORK_PHASE2_CONTAINER";

export const isPhase2ContainerMode = (env = process.env) =>
  env?.[PHASE2_CONTAINER_FLAG]?.trim() === "1";

export const assertExactLocalRuntimeUrl = (value, name, env = process.env) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed;
  }

  if (isPhase2ContainerMode(env) && PHASE2_SERVICE_HOSTS.has(parsed.hostname)) {
    return parsed;
  }

  throw new Error(`${name} must use an exact local host or loopback target.`);
};
