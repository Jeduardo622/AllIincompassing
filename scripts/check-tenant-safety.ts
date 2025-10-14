#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.ALLOW_CROSS_ORG_TEST === "1") {
  console.log("tenant-safety: bypassed via ALLOW_CROSS_ORG_TEST");
  process.exit(0);
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(PROJECT_ROOT, "supabase", "functions");
const TARGET_TABLES = ["sessions", "therapists", "clients", "billing_records"];
const CRITICAL_FILES = new Set([
  path.join(FUNCTIONS_DIR, "generate-report", "index.ts"),
  path.join(FUNCTIONS_DIR, "sessions-cancel", "index.ts"),
]);
const ALLOWED_SERVICE_ROLE_FILES = new Set([
  path.join(FUNCTIONS_DIR, "sessions-cancel", "index.ts"),
]);

const issues: string[] = [];

for (const filePath of walk(FUNCTIONS_DIR)) {
  if (!CRITICAL_FILES.has(filePath)) {
    continue;
  }
  const content = readFileSync(filePath, "utf8");

  if (content.includes("supabaseAdmin") && !ALLOWED_SERVICE_ROLE_FILES.has(filePath)) {
    issues.push(`service-role usage detected in ${rel(filePath)}; use request client + org helpers`);
  }

  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const table of TARGET_TABLES) {
      if (!line.includes(`.${"from"}("${table}"`) && !line.includes(`.${"from"}('${table}'`)) {
        continue;
      }

      const window = lines.slice(index, index + 12).join(" ");
      const snippet = lines.slice(Math.max(0, index - 2), index + 12).join(" ");

      if (snippet.includes("orgScopedQuery")) {
        continue;
      }

      if (!window.includes('organization_id') && !snippet.includes('organization_id')) {
        issues.push(
          `query on ${table} in ${rel(filePath)} lacks organization guard near line ${index + 1}`,
        );
      }
    }
  });
}

if (issues.length > 0) {
  console.error("Tenant safety violations detected:\n");
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  console.error("\nSet ALLOW_CROSS_ORG_TEST=1 to bypass (not recommended).");
  process.exit(1);
}

console.log("tenant-safety: all checks passed");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === "_shared" || entry === "__tests__") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function rel(filePath: string) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}
