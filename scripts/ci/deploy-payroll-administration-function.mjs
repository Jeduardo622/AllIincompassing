import { spawnSync } from "node:child_process";
import { validateEdgeDeployPrerequisites } from "./check-edge-deploy-prerequisites.mjs";

const FUNCTION_SLUG = "payroll-administration";
const REQUIRED_EDGE_SECRETS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];
const DOCKER_RATE_LIMIT_PATTERN = /(toomanyrequests|rate exceeded|public\.ecr\.aws\/supabase\/edge-runtime)/i;
const verifySecretsOnly = process.argv.length === 3 && process.argv[2] === "--verify-edge-secrets";

if (process.argv.length > (verifySecretsOnly ? 3 : 2)) {
  console.error("Unsupported payroll-administration deploy arguments.");
  process.exit(1);
}

const runSupabase = (args) =>
  spawnSync("supabase", args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });

const writeResultOutput = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const looksLikeDockerRateLimit = (result) => {
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  return DOCKER_RATE_LIMIT_PATTERN.test(output);
};

const prereqResult = validateEdgeDeployPrerequisites({
  env: process.env,
  deployTargetLabel: FUNCTION_SLUG,
});

if (!prereqResult.ok) {
  console.error(prereqResult.message);
  process.exit(1);
}

const { projectRef } = prereqResult;
const secretListResult = runSupabase(["secrets", "list", "--project-ref", projectRef, "--output", "json"]);
if ((secretListResult.status ?? 1) !== 0) {
  console.error("Could not verify remote Edge secret names.");
  process.exit(secretListResult.status ?? 1);
}

let remoteSecrets = [];
try {
  remoteSecrets = JSON.parse(secretListResult.stdout || "[]");
} catch {
  console.error("Could not parse `supabase secrets list` JSON output.");
  process.exit(1);
}

const remoteSecretNames = new Set(
  Array.isArray(remoteSecrets)
    ? remoteSecrets.map((item) => item?.name).filter((name) => typeof name === "string")
    : [],
);
for (const requiredSecret of REQUIRED_EDGE_SECRETS) {
  if (!remoteSecretNames.has(requiredSecret)) {
    console.error(`Missing remote Edge secret: ${requiredSecret}`);
    process.exit(1);
  }
}
console.log("Required payroll-administration remote Edge secret names verified.");

if (verifySecretsOnly) {
  process.exit(0);
}

console.log(`Deploying ${FUNCTION_SLUG} to project ${projectRef}...`);
const deployArgs = ["functions", "deploy", FUNCTION_SLUG, "--project-ref", projectRef];
let deployResult = runSupabase(deployArgs);
writeResultOutput(deployResult);

if ((deployResult.status ?? 1) !== 0 && looksLikeDockerRateLimit(deployResult)) {
  console.warn(`Docker bundle rate limit hit while deploying ${FUNCTION_SLUG}; retrying with --use-api.`);
  deployResult = runSupabase([...deployArgs, "--use-api"]);
  writeResultOutput(deployResult);
}

if ((deployResult.status ?? 1) !== 0) {
  console.error(`Failed to deploy ${FUNCTION_SLUG}.`);
  process.exit(deployResult.status ?? 1);
}

const listResult = runSupabase(["functions", "list", "--project-ref", projectRef, "--output", "json"]);
if ((listResult.status ?? 1) !== 0) {
  const details = String(listResult.stderr || listResult.stdout || "").trim();
  console.error(`Could not verify deployed functions: ${details}`);
  process.exit(listResult.status ?? 1);
}

let deployed = [];
try {
  deployed = JSON.parse(listResult.stdout || "[]");
} catch {
  console.error("Could not parse `supabase functions list` JSON output.");
  process.exit(1);
}

const deployedFunction = Array.isArray(deployed)
  ? deployed.find((item) => item?.slug === FUNCTION_SLUG)
  : null;

if (!deployedFunction) {
  console.error(`Missing deployed function after deploy: ${FUNCTION_SLUG}`);
  process.exit(1);
}

if (deployedFunction.verify_jwt !== true) {
  console.error(`verify_jwt must be true for ${FUNCTION_SLUG}.`);
  process.exit(1);
}

console.log(`${FUNCTION_SLUG} deployed and verified.`);
