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
    /** @type {string} */
    let rawSql;
    try {
      rawSql = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
      if (code !== 'ENOENT') {
        throw err;
      }
      // Staged/worktree renames can leave `git diff HEAD~1 HEAD` listing the pre-rename path while
      // only the new filename exists on disk; read the blob from HEAD when the path is missing.
      try {
        rawSql = execSync(`git show HEAD:${migrationPath.replace(/\\/g, '/')}`, {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch (inner) {
        console.error(
          `RLS policy coverage: migration path missing on disk and not readable from HEAD: ${migrationPath}`,
        );
        throw inner;
      }
    }
    const sql = rawSql.toLowerCase();
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
