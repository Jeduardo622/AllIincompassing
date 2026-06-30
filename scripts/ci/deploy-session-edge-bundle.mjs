import { spawnSync } from "node:child_process";

/** Session lifecycle, care-plan, and assessment edge routes deployed before policy checks in CI. Keep in sync with docs/supabase_branching.md and README. */
const REQUIRED_FUNCTIONS = [
  "sessions-book",
  "sessions-hold",
  "sessions-confirm",
  "sessions-start",
  "sessions-cancel",
  "sessions-complete",
  "generate-session-notes-pdf",
  "session-notes-pdf-status",
  "session-notes-pdf-download",
  "programs",
  "goals",
  "program-notes",
  "emails",
  "extract-assessment-fields",
  "generate-assessment-plan-docx",
];

const EXPECT_VERIFY_JWT = String(process.env.CI_EXPECT_VERIFY_JWT ?? "true").toLowerCase() !== "false";
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
