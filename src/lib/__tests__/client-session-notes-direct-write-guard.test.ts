/**
 * Regression guard: chained `.from('client_session_notes').insert|update|…` in product `src/`.
 * Intentionally not exhaustive: non-chained builders, alternate table identifiers, comments/strings
 * that resemble code, or unusual `.from(...)` shapes may evade detection — see inventory doc.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** src/ root (this file lives in src/lib/__tests__). */
const SRC_ROOT = join(__dirname, '..', '..');

const MUTATION_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

/**
 * After `.from('client_session_notes')`, walk a PostgREST-style chain of `.method(...)` calls.
 * Returns true if a mutation method appears before the chain ends.
 */
function hasMutationAfterFromLiteralTable(source: string, fromMatch: RegExpExecArray): boolean {
  let i = fromMatch.index + fromMatch[0].length;
  while (i < source.length) {
    const rest = source.slice(i);
    const chain = /^(\s*\.\s*)(\w+)\s*\(/.exec(rest);
    if (!chain) {
      break;
    }
    const method = chain[2];
    if (MUTATION_METHODS.has(method)) {
      return true;
    }
    i += chain[0].length;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      }
      i += 1;
    }
  }
  return false;
}

function fileDefinesClientSessionNotesTableConst(source: string): boolean {
  return /const\s+TABLE\s*=\s*['"]client_session_notes['"]/.test(source);
}

function scanFileForViolations(path: string, source: string): string[] {
  const violations: string[] = [];
  const fromLiteral = /\.from\(\s*['"]client_session_notes['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromLiteral.exec(source)) !== null) {
    if (hasMutationAfterFromLiteralTable(source, m)) {
      violations.push(`${path}: direct PostgREST mutation after .from('client_session_notes')`);
    }
  }

  if (fileDefinesClientSessionNotesTableConst(source)) {
    const fromTable = /\.from\(\s*TABLE\s*\)/g;
    while ((m = fromTable.exec(source)) !== null) {
      if (hasMutationAfterFromLiteralTable(source, m)) {
        violations.push(`${path}: direct PostgREST mutation after .from(TABLE) (client_session_notes)`);
      }
    }
  }

  return violations;
}

function walkSrcTsFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(SRC_ROOT, p).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') {
        continue;
      }
      if (rel === 'server' || rel === 'tests') {
        continue;
      }
      if (rel === 'lib/generated' || rel.startsWith('lib/generated/')) {
        continue;
      }
      walkSrcTsFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
}

describe('client_session_notes direct write guard', () => {
  it('does not use Supabase client mutations on client_session_notes in scoped app src', () => {
    const files: string[] = [];
    walkSrcTsFiles(SRC_ROOT, files);

    const allViolations: string[] = [];
    for (const abs of files) {
      const source = readFileSync(abs, 'utf8');
      const rel = relative(join(SRC_ROOT, '..'), abs).replace(/\\/g, '/');
      allViolations.push(...scanFileForViolations(rel, source));
    }

    expect(allViolations, allViolations.join('\n')).toEqual([]);
  });
});
