import { spawnSync } from "node:child_process";

const FUNCTION_SLUG = "ai-agent-optimized";
const DOCKER_RATE_LIMIT_PATTERN = /(toomanyrequests|rate exceeded|public\.ecr\.aws\/supabase\/edge-runtime)/i;

const parseProjectRef = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z0-9]{20}$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const host = new URL(trimmed).hostname;
    const [ref] = host.split(".");
    return ref?.trim() || null;
  } catch {
    return null;
  }
};

const runSupabase = (args) =>
  spawnSync("supabase", args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });

const writeResultOutput = (result) => {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
};

const looksLikeDockerRateLimit = (result) => {
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  return DOCKER_RATE_LIMIT_PATTERN.test(output);
};

const projectRef = parseProjectRef(process.env.SUPABASE_PROJECT_REF) ||
  parseProjectRef(process.env.SUPABASE_URL);

if (!projectRef) {
  console.error("❌ Missing project ref. Set SUPABASE_PROJECT_REF or SUPABASE_URL.");
  process.exit(1);
}

if (!process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN.trim().length === 0) {
  console.error("❌ Missing SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}

console.log(`Deploying ${FUNCTION_SLUG} to project ${projectRef}...`);
const deployArgs = ["functions", "deploy", FUNCTION_SLUG, "--project-ref", projectRef];
let deployResult = runSupabase(deployArgs);
writeResultOutput(deployResult);

if ((deployResult.status ?? 1) !== 0 && looksLikeDockerRateLimit(deployResult)) {
  console.warn(`⚠️ Docker bundle rate limit hit while deploying ${FUNCTION_SLUG}; retrying with --use-api.`);
  deployResult = runSupabase([...deployArgs, "--use-api"]);
  writeResultOutput(deployResult);
}

if ((deployResult.status ?? 1) !== 0) {
  console.error(`❌ Failed to deploy ${FUNCTION_SLUG}.`);
  process.exit(deployResult.status ?? 1);
}

const listResult = runSupabase(["functions", "list", "--project-ref", projectRef, "--output", "json"]);
if ((listResult.status ?? 1) !== 0) {
  const details = String(listResult.stderr || listResult.stdout || "").trim();
  console.error(`❌ Could not verify deployed functions: ${details}`);
  process.exit(listResult.status ?? 1);
}

let deployed = [];
try {
  deployed = JSON.parse(listResult.stdout || "[]");
} catch {
  console.error("❌ Could not parse `supabase functions list` JSON output.");
  process.exit(1);
}

const deployedFunction = Array.isArray(deployed)
  ? deployed.find((item) => item?.slug === FUNCTION_SLUG)
  : null;

if (!deployedFunction) {
  console.error(`❌ Missing deployed function after deploy: ${FUNCTION_SLUG}`);
  process.exit(1);
}

if (deployedFunction.verify_jwt !== true) {
  console.error(`❌ verify_jwt must be true for ${FUNCTION_SLUG}.`);
  process.exit(1);
}

console.log(`✅ ${FUNCTION_SLUG} deployed and verified.`);
