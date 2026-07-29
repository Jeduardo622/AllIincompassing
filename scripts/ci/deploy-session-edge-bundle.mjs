import { spawnSync } from "node:child_process";
import { validateEdgeDeployPrerequisites } from "./check-edge-deploy-prerequisites.mjs";

/** Session lifecycle, care-plan, and assessment edge routes deployed before policy checks in CI. Keep in sync with docs/supabase_branching.md and README. */
const REQUIRED_FUNCTIONS = [
  "sessions-book",
  "sessions-hold",
  "sessions-confirm",
  "sessions-start",
  "sessions-cancel",
  "sessions-reactivate",
  "sessions-complete",
  "generate-session-notes-pdf",
  "session-notes-pdf-status",
  "session-notes-pdf-download",
  "programs",
  "goals",
  "goal-targets",
  "program-notes",
  "emails",
  "extract-assessment-fields",
  "generate-assessment-plan-docx",
  "utilization-report",
];

const EXPECT_VERIFY_JWT = String(process.env.CI_EXPECT_VERIFY_JWT ?? "true").toLowerCase() !== "false";
const DOCKER_RATE_LIMIT_PATTERN = /(toomanyrequests|rate exceeded|public\.ecr\.aws\/supabase\/edge-runtime)/i;

const runSupabase = (args) => {
  return spawnSync("supabase", args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
};

const runSupabaseJson = (args) => {
  const result = spawnSync("supabase", args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  return result;
};

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

const prereqResult = validateEdgeDeployPrerequisites({
  env: process.env,
  deployTargetLabel: "session edge",
});

if (!prereqResult.ok) {
  console.error(prereqResult.message);
  process.exit(1);
}

const { projectRef } = prereqResult;

console.log(`Deploying required edge function bundle to project ${projectRef}...`);
for (const fn of REQUIRED_FUNCTIONS) {
  const deployArgs = ["functions", "deploy", fn, "--project-ref", projectRef];
  let result = runSupabase(deployArgs);
  writeResultOutput(result);

  if ((result.status ?? 1) !== 0 && looksLikeDockerRateLimit(result)) {
    console.warn(`⚠️ Docker bundle rate limit hit while deploying ${fn}; retrying with --use-api.`);
    result = runSupabase([...deployArgs, "--use-api"]);
    writeResultOutput(result);
  }

  if ((result.status ?? 1) !== 0) {
    console.error(`❌ Failed to deploy ${fn}.`);
    process.exit(result.status ?? 1);
  }
}

const listResult = runSupabaseJson(["functions", "list", "--project-ref", projectRef, "--output", "json"]);
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

const deployedSlugs = new Set(Array.isArray(deployed) ? deployed.map((item) => item?.slug).filter(Boolean) : []);
const missing = REQUIRED_FUNCTIONS.filter((slug) => !deployedSlugs.has(slug));
if (missing.length > 0) {
  console.error(`❌ Missing deployed functions after deploy: ${missing.join(", ")}`);
  process.exit(1);
}

const jwtMismatches = Array.isArray(deployed)
  ? deployed
      .filter((item) => REQUIRED_FUNCTIONS.includes(item?.slug))
      .filter((item) => item?.verify_jwt !== EXPECT_VERIFY_JWT)
      .map((item) => item?.slug)
  : [];
if (jwtMismatches.length > 0) {
  console.error(
    `❌ verify_jwt must be ${EXPECT_VERIFY_JWT} for lifecycle functions: ${jwtMismatches.join(", ")}`,
  );
  process.exit(1);
}

console.log(`✅ Required edge function bundle deployed and verified (${REQUIRED_FUNCTIONS.length} functions).`);
