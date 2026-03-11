import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

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

const run = async () => {
  const failures = [];

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
      continue;
    }

    if (
      endpoint.expectedContentType &&
      !/['"]Content-Type['"]\s*:\s*['"]application\/json['"]/.test(netlifyText)
    ) {
      failures.push(`${endpoint.route}: wrapper is missing JSON content-type response contract.`);
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
