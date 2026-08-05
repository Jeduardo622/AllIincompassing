import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type ActionStep = {
  file: string;
  uses: string;
  nodeVersion?: unknown;
};

const workflowDir = path.join(process.cwd(), '.github', 'workflows');

const expectedWorkflowFiles = [
  'agent-work-ledger-hosted-shadow-proof.yml',
  'auth-verification.yml',
  'bcba-smoke-janitor.yml',
  'bt-aba-disposable-browser-proof.yml',
  'ci.yml',
  'database-first-ci.yml',
  'iehp-pdf-mini-matrix-proof.yml',
  'lighthouse.yml',
  'rollback-drill.yml',
  'supabase-preview.yml',
  'supabase-validate.yml',
  'tenant-safety.yml',
];

const expectedPins = {
  'actions/checkout': 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
  'actions/download-artifact': '37930b1c2abaa49bbe596cd826c3c89aef350131',
  'actions/setup-node': 'a0853c24544627f65ddf259abe73b1d18a591444',
  'actions/upload-artifact': 'b7c566a772e6b6bfb58ed0dc250532a479d7789f',
} as const;

const targetActions = new Set(Object.keys(expectedPins));

const collectActionSteps = (value: unknown, file: string, results: ActionStep[] = []): ActionStep[] => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectActionSteps(entry, file, results));
    return results;
  }

  if (!value || typeof value !== 'object') {
    return results;
  }

  const record = value as Record<string, unknown>;
  const uses = typeof record.uses === 'string' ? record.uses : undefined;

  if (uses) {
    const [action] = uses.split('@');
    if (targetActions.has(action)) {
      const withBlock =
        record.with && typeof record.with === 'object' ? (record.with as Record<string, unknown>) : undefined;
      results.push({
        file,
        uses,
        nodeVersion: withBlock?.['node-version'],
      });
    }
  }

  Object.values(record).forEach((entry) => collectActionSteps(entry, file, results));
  return results;
};

describe('GitHub Actions runtime pins', () => {
  it('pins GitHub-authored actions to the verified SHAs and keeps the app toolchain on Node 20', () => {
    const workflowFiles = readdirSync(workflowDir).filter((entry) => entry.endsWith('.yml')).sort();
    const actionSteps = workflowFiles.flatMap((file) => {
      const source = readFileSync(path.join(workflowDir, file), 'utf8');
      return collectActionSteps(parse(source), file);
    });

    const matchedFiles = Array.from(new Set(actionSteps.map((step) => step.file))).sort();
    expect(matchedFiles).toEqual(expectedWorkflowFiles);

    expect(actionSteps.length).toBeGreaterThan(0);

    for (const step of actionSteps) {
      const [action, ref] = step.uses.split('@');
      expect(ref, `${step.file} should pin ${action}`).toBe(expectedPins[action as keyof typeof expectedPins]);

      if (action === 'actions/setup-node') {
        expect(step.nodeVersion, `${step.file} should keep setup-node on Node 20`).toBe(20);
      }
    }
  });
});
