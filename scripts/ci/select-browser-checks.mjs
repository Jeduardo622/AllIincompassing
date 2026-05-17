import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const TIER0_SPECS = {
  public: "cypress/e2e/routes_public.cy.ts",
  client: "cypress/e2e/routes_client.cy.ts",
  schedule: "cypress/e2e/routes_schedule.cy.ts",
  admin: "cypress/e2e/routes_admin.cy.ts",
  auth: "cypress/e2e/routes_auth.cy.ts",
};

const allSpecKeys = Object.keys(TIER0_SPECS);

const normalizePath = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "");

const runGit = (args) => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    base: process.env.BASE_SHA ?? "",
    head: process.env.HEAD_SHA ?? "HEAD",
    format: "text",
    changedFiles: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base") {
      parsed.base = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--head") {
      parsed.head = args[index + 1] ?? "HEAD";
      index += 1;
    } else if (arg === "--format") {
      parsed.format = args[index + 1] ?? "text";
      index += 1;
    } else if (arg === "--changed-file") {
      parsed.changedFiles.push(normalizePath(args[index + 1] ?? ""));
      index += 1;
    }
  }

  return parsed;
};

const changedFilesForRange = ({ base, head }) => {
  if (!base || /^0+$/.test(base)) {
    return { files: [], fallbackFull: true };
  }

  try {
    const output = runGit(["diff", "--name-only", base, head || "HEAD"]);
    const files = output
      .split(/\r?\n/)
      .map((file) => normalizePath(file.trim()))
      .filter(Boolean);

    if (files.length === 0) {
      return { files: [], fallbackFull: true };
    }

    return { files, fallbackFull: false };
  } catch (error) {
    console.warn(`[browser-checks] ${error.message}`);
    return { files: [], fallbackFull: true };
  }
};

const matchAny = (file, patterns) => patterns.some((pattern) => pattern.test(file));

const classifyFile = (file) => {
  if (matchAny(file, [
    /^\.github\/workflows\//,
    /^scripts\/ci\//,
    /^scripts\/ci\/select-browser-checks\.mjs$/,
    /^scripts\/run-cypress\.ts$/,
    /^package(-lock)?\.json$/,
    /^cypress\.config\.cjs$/,
    /^vite\.config\./,
    /^netlify\.toml$/,
    /^cypress\/support\//,
    /^src\/App\.tsx$/,
    /^src\/main\.tsx$/,
    /^src\/components\/PrivateRoute\.tsx$/,
    /^src\/components\/RoleGuard\.tsx$/,
    /^src\/components\/Sidebar\.tsx$/,
    /^src\/lib\/auth/,
    /^src\/lib\/runtimeConfig/,
  ])) {
    return { specs: allSpecKeys, authSmoke: true, reason: "shared route/auth surface" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\/routes_public\.cy\.ts$/,
    /^src\/pages\/(Login|Signup|PasswordRecovery|Unauthorized)\.tsx$/,
  ])) {
    return { specs: ["public", "auth"], authSmoke: true, reason: "public auth route" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\/routes_auth\.cy\.ts$/,
    /^scripts\/playwright-/,
    /^supabase\/functions\/(sessions-|session-|auth-|programs|goals|program-notes)/,
  ])) {
    return { specs: ["auth", "schedule"], authSmoke: true, reason: "auth/session browser flow" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\/routes_schedule\.cy\.ts$/,
    /^src\/pages\/Schedule\.tsx$/,
    /^src\/features\/scheduling\//,
    /^src\/server\/api\/(book|sessions)/,
    /^src\/lib\/(sessions|booking|useRouteQueryRefetch)/,
  ])) {
    return { specs: ["schedule", "auth"], authSmoke: true, reason: "schedule/session route" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\/routes_client\.cy\.ts$/,
    /^src\/pages\/(Dashboard|Clients|ClientDetails|ClientOnboarding|Documentation|Authorizations)\.tsx$/,
    /^src\/components\/Client/,
    /^src\/components\/Documentation/,
    /^src\/lib\/(clients|authorizations|therapist-documents|assessment-documents)/,
  ])) {
    return { specs: ["client"], authSmoke: false, reason: "client/documentation route" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\/routes_admin\.cy\.ts$/,
    /^src\/pages\/(Therapists|Billing|Monitoring|Reports|Settings|SuperAdmin)/,
    /^src\/components\/(Therapist|Billing|Monitoring|Reports|Settings|SuperAdmin)/,
    /^src\/components\/(therapists?|billing|monitoring|reports|settings|super-?admin)\//,
    /^src\/lib\/(therapists|billing|reports|settings|featureFlags)/,
  ])) {
    return { specs: ["admin"], authSmoke: false, reason: "admin/back-office route" };
  }

  if (matchAny(file, [
    /^cypress\/e2e\//,
  ])) {
    return { specs: allSpecKeys, authSmoke: true, reason: "unmapped Cypress browser spec" };
  }

  if (matchAny(file, [
    /^src\/pages\//,
    /^src\/lib\/route/,
  ])) {
    return { specs: allSpecKeys, authSmoke: false, reason: "unmapped route-capable UI surface" };
  }

  return { specs: [], authSmoke: false, reason: "non-route surface" };
};

const selectBrowserChecks = (files, fallbackFull) => {
  const selectedSpecs = new Set();
  const reasons = [];
  let authSmokeRequired = false;

  if (fallbackFull) {
    return {
      tier0Required: true,
      authSmokeRequired: true,
      tier0Specs: allSpecKeys.map((key) => TIER0_SPECS[key]),
      reasons: ["diff unavailable; running full browser gates"],
      changedFiles: files,
    };
  }

  for (const file of files) {
    const classification = classifyFile(file);
    for (const spec of classification.specs) {
      selectedSpecs.add(spec);
    }
    authSmokeRequired = authSmokeRequired || classification.authSmoke;
    if (classification.specs.length > 0 || classification.authSmoke) {
      reasons.push(`${file}: ${classification.reason}`);
    }
  }

  return {
    tier0Required: selectedSpecs.size > 0,
    authSmokeRequired,
    tier0Specs: [...selectedSpecs].map((key) => TIER0_SPECS[key]),
    reasons,
    changedFiles: files,
  };
};

const writeGithubOutput = (selection) => {
  const lines = [
    `tier0_required=${selection.tier0Required ? "true" : "false"}`,
    `auth_smoke_required=${selection.authSmokeRequired ? "true" : "false"}`,
    `tier0_specs=${selection.tier0Specs.join(",")}`,
  ];

  for (const line of lines) {
    console.log(line);
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
  }
};

const main = () => {
  const args = parseArgs();
  const { files, fallbackFull } = args.changedFiles.length > 0
    ? { files: args.changedFiles.filter(Boolean), fallbackFull: false }
    : changedFilesForRange(args);
  const selection = selectBrowserChecks(files, fallbackFull);

  if (args.format === "github-output") {
    writeGithubOutput(selection);
    return;
  }

  console.log(JSON.stringify(selection, null, 2));
};

main();
