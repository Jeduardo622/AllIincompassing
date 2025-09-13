"use strict";
const fs = require("fs");
const path = require("path");

// Needles to search for (service role usage indicators)
const NEEDLES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE",
  "service_role",
];

const BAD = [];

// Only scan code files
const CODE_EXT = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

const ALLOWLIST = [
  /\/_shared\//,                              // allow shared helpers
  /\/admin(\/|-[^/]*\/)\/,                     // allow admin/ and admin-* folders (fixed trailing slash)
  /\/\.github\//,                             // ignore GitHub workflows
  /\/patches\//,                              // ignore patch files
  /\/supabase\/functions\/.*\/deps\.ts$/,     // ignore deps.ts in functions
  /\/supabase\/functions\/.*\/import_map\.json$/, // ignore import maps
];

function isAllowed(p) {
  return ALLOWLIST.some(rx => rx.test(p));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const p = full.split(path.sep).join("/");

    // Self-ignore this audit script
    if (p.endsWith("/scripts/audit-service-role-usage.cjs")) continue;

    if (!p.includes("/supabase/functions/") && !p.includes("/scripts/")) continue;
    if (!CODE_EXT.some(ext => p.endsWith(ext))) continue;

    const text = fs.readFileSync(full, "utf8");
    if (NEEDLES.some(n => text.includes(n)) && !isAllowed(p)) {
      BAD.push(p);
    }
  }
}

// Scan from repo root
walk(process.cwd());

if (BAD.length) {
  console.error("❌ Forbidden SERVICE_ROLE usage found:");
  for (const b of BAD) console.error(" -", b);
  process.exit(1);
} else {
  console.log("✅ No forbidden SERVICE_ROLE usage found.");
}
