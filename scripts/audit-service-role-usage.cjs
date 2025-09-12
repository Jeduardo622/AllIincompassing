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

// --- start replacement block ---
const ALLOWLIST = [
  /\/_shared\//,                  // allow constants & helpers (contains SERVICE_ROLE_KEY)
  /\/admin(\/|-[^/]*\/)\/,         // allow admin/ and admin-* function folders
  /\/\.github\//,                 // ignore GitHub workflows
  /\/patches\//,                  // ignore patch files
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
    if (!p.includes("/supabase/functions/") && !p.includes("/scripts/")) continue;

    const text = fs.readFileSync(full, "utf8");
    if (NEEDLES.some(n => text.includes(n)) && !isAllowed(p)) {
      BAD.push(p);
    }
  }
}
// --- end replacement block ---

// Scan from repo root
walk(process.cwd());

// Also append this at the end, before process.exit:
if (BAD.length) {
  console.error("❌ Forbidden SERVICE_ROLE usage found:");
  for (const b of BAD) console.error(" -", b);
  process.exit(1);
} else {
  console.log("✅ No forbidden SERVICE_ROLE usage found.");
}
