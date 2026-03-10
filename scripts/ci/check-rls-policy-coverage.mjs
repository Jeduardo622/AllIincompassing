import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const collectAddedMigrationFiles = () => {
  const files = new Set();
  const collect = (command) => {
    try {
      const output = execSync(command, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('supabase/migrations/') && line.endsWith('.sql'))
        .forEach((line) => files.add(line));
    } catch {
      // Best effort.
    }
  };

  let mergeBase = '';
  try {
    mergeBase = execSync('git merge-base HEAD origin/main', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    mergeBase = '';
  }

  if (mergeBase) {
    collect(`git diff --name-only --diff-filter=A ${mergeBase} HEAD`);
  }
  collect('git diff --name-only --diff-filter=A HEAD~1 HEAD');
  collect('git diff --name-only --diff-filter=A');
  collect('git diff --cached --name-only --diff-filter=A');
  collect('git ls-files --others --exclude-standard supabase/migrations/*.sql');

  return [...files];
};

const main = () => {
  const addedMigrations = collectAddedMigrationFiles();
  if (addedMigrations.length === 0) {
    console.log('RLS policy coverage check passed (no new migration files detected).');
    return;
  }

  const errors = [];
  for (const migrationPath of addedMigrations) {
    const absolutePath = path.join(ROOT, migrationPath);
    const sql = readFileSync(absolutePath, 'utf8').toLowerCase();
    const enablesRls = sql.includes('enable row level security');
    const createsPolicy = sql.includes('create policy');

    if (enablesRls && !createsPolicy) {
      errors.push(
        `${migrationPath} enables RLS but does not define any CREATE POLICY statements in the same migration.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('RLS policy coverage check failed:');
    errors.forEach((message) => console.error(`- ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log(`RLS policy coverage check passed (${addedMigrations.length} new migration file(s) validated).`);
};

main();
