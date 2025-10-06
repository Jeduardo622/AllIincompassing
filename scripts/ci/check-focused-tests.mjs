import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SEARCH_ROOTS = ['src', 'tests'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage']);
const ALLOWED_FILES = new Set([
  path.join('tests', 'utils', 'testControls.ts'),
]);
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PATTERN = /\.(?:only|skip)(?:\s*\(|\b)/g;

const violations = [];

const walk = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error?.code ?? '') === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        return;
      }
      await walk(resolved);
      return;
    }

    if (!entry.isFile()) {
      return;
    }

    const extension = path.extname(entry.name);
    if (!FILE_EXTENSIONS.has(extension)) {
      return;
    }

    const relativePath = path.relative(process.cwd(), resolved);
    if (ALLOWED_FILES.has(relativePath)) {
      return;
    }

    const content = await readFile(resolved, 'utf8');

    let match;
    while ((match = PATTERN.exec(content)) !== null) {
      const before = content.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      violations.push({
        file: relativePath,
        line,
        match: match[0],
      });
    }
  }));
};

const run = async () => {
  await Promise.all(SEARCH_ROOTS.map((root) => walk(path.join(process.cwd(), root))));

  if (violations.length === 0) {
    return;
  }

  console.error('Focused or skipped tests detected outside approved helpers:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} contains \`${violation.match}\``);
  }
  console.error('Use tests/utils/testControls.ts helpers to guard conditional suites or tests.');
  process.exitCode = 1;
};

run().catch((error) => {
  console.error('Failed to verify focused test usage.');
  console.error(error);
  process.exitCode = 1;
});
