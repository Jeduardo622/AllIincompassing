#!/usr/bin/env tsx

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBranchAuditReport, generateBranchAuditReport } from '../src/scripts/gitBranchAudit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const targetFile = path.join(repoRoot, 'docs', 'branch-hygiene-targets.json');

function main(): void {
  try {
    const report = generateBranchAuditReport(repoRoot, targetFile);
    console.log(formatBranchAuditReport(report));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Git branch audit failed: ${message}`);
    process.exit(1);
  }
}

main();
