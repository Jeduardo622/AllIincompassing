/**
 * Injects short repo guardrails into new Agent sessions (fire-and-forget hook).
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";

const CONTEXT = [
  "[Project hooks] AllIincompassing guardrails:",
  "- High-risk areas (human review before merge): supabase/migrations, supabase/functions, src/server, src/lib/auth*, src/lib/runtimeConfig*, scripts/ci, .github/workflows, netlify.toml.",
  "- Do not read or commit real .env* secrets; use .env.example / synthetic fixtures.",
  "- After substantive edits: npm run lint, npm run typecheck, npm run test:ci (and policy checks when touching protected surfaces).",
  "- Tenant/auth surfaces: npm run validate:tenant when DB/RLS paths change.",
].join("\n");

readStdinJson()
  .then(() => {
    process.stdout.write(JSON.stringify({ additional_context: CONTEXT }));
    process.exit(0);
  })
  .catch(() => {
    process.stdout.write("{}");
    process.exit(0);
  });
