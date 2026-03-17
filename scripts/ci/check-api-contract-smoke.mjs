import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const REQUIRED_EDGE_FUNCTIONS = [
  "sessions-hold",
  "sessions-confirm",
  "sessions-start",
  "sessions-cancel",
  "generate-session-notes-pdf",
];

const CRITICAL_ENDPOINTS = [
  {
    route: "/api/runtime-config",
    netlifyFunction: "runtime-config.ts",
    expectedContentType: "application/json",
  },
  {
    route: "/api/dashboard",
    netlifyFunction: "dashboard.ts",
    sourceFile: "src/server/api/dashboard.ts",
    handlerSymbol: "dashboardHandler",
    expectedMethod: "GET",
    expectedContentType: "application/json",
  },
  {
    route: "/api/book",
    netlifyFunction: "book.ts",
    sourceFile: "src/server/api/book.ts",
    handlerSymbol: "bookHandler",
    expectedMethod: "POST",
    expectedContentType: "application/json",
    requireBearerChallenge: true,
  },
  {
    route: "/api/sessions-start",
    netlifyFunction: "sessions-start.ts",
    sourceFile: "src/server/api/sessions-start.ts",
    handlerSymbol: "sessionsStartHandler",
    expectedMethod: "POST",
    expectedContentType: "application/json",
  },
];

const readText = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  return readFile(absolutePath, "utf8");
};

const parseProjectRef = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
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

const parseBoolean = (value, fallback) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return /^(1|true|yes)$/i.test(value);
};

const run = async () => {
  const failures = [];
  const edgeParityRequired = parseBoolean(
    process.env.CI_EDGE_ROUTE_PARITY_REQUIRED,
    parseBoolean(process.env.CI_SUPABASE_AUTH_PARITY_REQUIRED, process.env.CI === "true"),
  );

  for (const endpoint of CRITICAL_ENDPOINTS) {
    const netlifyPath = `netlify/functions/${endpoint.netlifyFunction}`;
    const netlifyText = await readText(netlifyPath);
    if (endpoint.sourceFile) {
      const sourceText = await readText(endpoint.sourceFile);
      const sourceImportStem = endpoint.sourceFile.replace(/\\/g, "/").replace(/^src\//, "../../src/").replace(/\.ts$/, "");
      if (!netlifyText.includes(sourceImportStem)) {
        failures.push(`${endpoint.route}: wrapper does not import source handler from ${endpoint.sourceFile}.`);
      }

      if (endpoint.handlerSymbol && !netlifyText.includes(endpoint.handlerSymbol)) {
        failures.push(`${endpoint.route}: wrapper does not invoke ${endpoint.handlerSymbol}.`);
      }

      if (endpoint.expectedMethod && !sourceText.includes(`request.method !== "${endpoint.expectedMethod}"`)) {
        failures.push(`${endpoint.route}: source handler is missing ${endpoint.expectedMethod}-method enforcement.`);
      }

      if (
        endpoint.expectedContentType &&
        !/['"]Content-Type['"]\s*:\s*['"]application\/json['"]/.test(sourceText)
      ) {
        failures.push(`${endpoint.route}: source handler is missing JSON content-type response contract.`);
      }
      if (endpoint.requireBearerChallenge && !sourceText.includes('"WWW-Authenticate": "Bearer"')) {
        failures.push(`${endpoint.route}: source handler must return WWW-Authenticate Bearer on unauthorized path.`);
      }
      continue;
    }

    if (
      endpoint.expectedContentType &&
      !/['"]Content-Type['"]\s*:\s*['"]application\/json['"]/.test(netlifyText)
    ) {
      failures.push(`${endpoint.route}: wrapper is missing JSON content-type response contract.`);
    }
  }

  if (edgeParityRequired) {
    const projectRef = parseProjectRef(process.env.SUPABASE_PROJECT_REF) || parseProjectRef(process.env.SUPABASE_URL);
    if (!projectRef) {
      failures.push("edge parity: missing SUPABASE_PROJECT_REF or SUPABASE_URL.");
    } else if (!process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN.trim().length === 0) {
      failures.push("edge parity: missing SUPABASE_ACCESS_TOKEN.");
    } else {
      const listResult = spawnSync(
        "supabase",
        ["functions", "list", "--project-ref", projectRef, "--output", "json"],
        {
          cwd: ROOT,
          env: process.env,
          encoding: "utf8",
          shell: process.platform === "win32",
        },
      );
      if (listResult.status !== 0) {
        const details = String(listResult.stderr || listResult.stdout || "").trim();
        failures.push(`edge parity: failed to list functions (${details || `exit ${listResult.status}`}).`);
      } else {
        let parsed = [];
        try {
          parsed = JSON.parse(String(listResult.stdout || "[]"));
        } catch {
          failures.push("edge parity: could not parse JSON from `supabase functions list`.");
        }
        if (Array.isArray(parsed)) {
          const deployed = new Set(parsed.map((item) => item?.slug).filter(Boolean));
          for (const slug of REQUIRED_EDGE_FUNCTIONS) {
            if (!deployed.has(slug)) {
              failures.push(`edge parity: function "${slug}" missing in project ${projectRef}.`);
            }
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error("Critical /api contract smoke check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Critical /api contract smoke check passed (${CRITICAL_ENDPOINTS.length} routes).`);
};

run().catch((error) => {
  console.error("Critical /api contract smoke check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
