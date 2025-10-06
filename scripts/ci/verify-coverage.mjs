import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COVERAGE_FILE = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
const MIN_LINE_COVERAGE = 85;

const formatPct = (value) => `${value.toFixed(2)}%`;

const run = async () => {
  let fileContents;
  try {
    fileContents = await readFile(COVERAGE_FILE, 'utf8');
  } catch (error) {
    if ((error?.code ?? '') === 'ENOENT') {
      throw new Error(`Coverage summary not found at ${COVERAGE_FILE}`);
    }
    throw error;
  }

  let summary;
  try {
    summary = JSON.parse(fileContents);
  } catch (error) {
    throw new Error('Coverage summary JSON is invalid.');
  }

  const lineCoverage = summary?.total?.lines?.pct;
  if (typeof lineCoverage !== 'number' || Number.isNaN(lineCoverage)) {
    throw new Error('Line coverage percentage missing from coverage summary.');
  }

  if (lineCoverage < MIN_LINE_COVERAGE) {
    throw new Error(
      `Line coverage ${formatPct(lineCoverage)} is below the required ${formatPct(MIN_LINE_COVERAGE)} threshold.`,
    );
  }

  console.log(`Line coverage ${formatPct(lineCoverage)} meets the required ${formatPct(MIN_LINE_COVERAGE)} threshold.`);
};

run().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
