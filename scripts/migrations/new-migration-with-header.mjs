import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

const usage = () => {
  console.error("Usage: node scripts/migrations/new-migration-with-header.mjs <migration_name>");
  process.exitCode = 1;
};

const sanitize = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const timestamp = () => {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
};

const template = (name) => `-- @migration-intent: ${name}
-- @migration-dependencies: none
-- @migration-rollback: describe rollback strategy before applying

begin;

-- Write migration SQL here.

commit;
`;

const run = async () => {
  const input = process.argv.slice(2).join(" ");
  if (!input) {
    usage();
    return;
  }

  const name = sanitize(input);
  if (!name) {
    usage();
    return;
  }

  await mkdir(MIGRATIONS_DIR, { recursive: true });
  const fileName = `${timestamp()}_${name}.sql`;
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  await writeFile(filePath, template(name), "utf8");

  console.log(`Created ${path.relative(ROOT, filePath)} with required governance headers.`);
};

run().catch((error) => {
  console.error("Failed to create migration file.");
  console.error(error);
  process.exitCode = 1;
});
