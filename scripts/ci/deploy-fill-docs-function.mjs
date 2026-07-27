import { spawnSync } from "node:child_process";
import { validateEdgeDeployPrerequisites } from "./check-edge-deploy-prerequisites.mjs";

const FUNCTION_SLUG = "fill-docs";
const STATIC_FILE_DEPLOY_FAILURE_PATTERN =
  /(static[_ -]?files?|management api|--use-api|docker|toomanyrequests|rate exceeded|edge-runtime)/i;

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

const prereqResult = validateEdgeDeployPrerequisites({
  env: process.env,
  deployTargetLabel: FUNCTION_SLUG,
});

if (!prereqResult.ok) {
  console.error(prereqResult.message);
  process.exit(1);
}

const { projectRef } = prereqResult;

console.log(`Deploying ${FUNCTION_SLUG} to project ${projectRef}...`);
const deployResult = runSupabase(["functions", "deploy", FUNCTION_SLUG, "--project-ref", projectRef]);
writeResultOutput(deployResult);

if ((deployResult.status ?? 1) !== 0) {
  const details = [deployResult.stdout, deployResult.stderr, deployResult.error?.message]
    .filter(Boolean)
    .join("\n");

  if (STATIC_FILE_DEPLOY_FAILURE_PATTERN.test(details)) {
    console.error(
      `❌ Failed to deploy ${FUNCTION_SLUG}. Static-file functions must use Docker-backed Supabase CLI bundling; do not retry with --use-api.`,
    );
  } else {
    console.error(`❌ Failed to deploy ${FUNCTION_SLUG}.`);
  }

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
