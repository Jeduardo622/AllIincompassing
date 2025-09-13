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

// scan only runtime edge functions
const CODE_EXT = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

const ALLOWLIST = [
  /\/_shared\//,
  /\/admin(\/|-[^/]*\/)\//,
  /\/\.github\//,
  /\/patches\//,
];

function isAllowed(p) {
  return ALLOWLIST.some((rx) => rx.test(p));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const p = full.replaceAll("\\", "/");

    // scan only runtime edge functions
    if (!p.includes("/supabase/functions/")) continue;

    // also restrict to code files
    if (!CODE_EXT.some((ext) => p.endsWith(ext))) continue;

    if (isAllowed(p)) continue;

    const text = fs.readFileSync(full, "utf8");
    if (NEEDLES.some((n) => text.includes(n))) {
      BAD.push(p);
    }
  }
}

walk(process.cwd());

if (BAD.length) {
  console.error("❌ Forbidden SERVICE_ROLE usage found:");
  for (const b of BAD) console.error(" -", b);
  process.exit(1);
} else {
  console.log("✅ No forbidden SERVICE_ROLE usage found.");
}
