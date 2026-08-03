import {
  assertExactLocalRuntimeUrl,
  isPhase2ContainerMode,
} from "./localRuntime.mjs";

const requiredEnv = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const startAgentWorkItemsRuntime = ({
  supabaseUrl,
  runtimeFile,
  env = process.env,
  spawnImpl,
  platform = process.platform,
  cwd = process.cwd(),
}) => {
  if (isPhase2ContainerMode(env)) {
    const functionUrl = assertExactLocalRuntimeUrl(
      requiredEnv(env, "AGENT_WORK_ITEMS_URL"),
      "AGENT_WORK_ITEMS_URL",
      env,
    ).toString().replace(/\/$/, "");
    return { child: null, functionUrl, getOutput: () => "" };
  }

  const child = spawnImpl(
    platform === "win32" ? "supabase.exe" : "supabase",
    ["functions", "serve", "agent-work-items", "--no-verify-jwt", "--env-file", runtimeFile],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const collect = (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-4_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return {
    child,
    functionUrl: `${supabaseUrl}/functions/v1/agent-work-items`,
    getOutput: () => output,
  };
};
