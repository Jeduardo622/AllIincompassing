import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COVERAGE_FILE = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
const BASELINE_FILE = path.join(process.cwd(), 'reports', 'coverage-baseline.json');
const MIN_LINE_COVERAGE = 90;

const formatPct = (value) => `${value.toFixed(2)}%`;

const parseJsonFile = async (filePath, friendlyName) => {
  try {
    const contents = await readFile(filePath, 'utf8');
    try {
      return JSON.parse(contents);
    } catch (error) {
      throw new Error(`${friendlyName} JSON is invalid.`);
    }
  } catch (error) {
    if ((error?.code ?? '') === 'ENOENT') {
      throw new Error(`${friendlyName} not found at ${filePath}`);
    }
    throw error;
  }
};

const assertTotalCoverage = (summary) => {
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

const normalizeModulePath = (modulePath) => {
  if (typeof modulePath !== 'string') {
    throw new Error('Module path must be a string when normalizing coverage requirements.');
  }

  const trimmed = modulePath.trim();
  if (trimmed === '') {
    throw new Error('Module path must not be empty when normalizing coverage requirements.');
  }

  const unixified = trimmed.replace(/\\/g, '/');
  const normalized = path.normalize(unixified);
  const absolute = path.isAbsolute(normalized) ? normalized : path.join(process.cwd(), normalized);
  const relative = path.relative(process.cwd(), absolute);

  return relative.split(path.sep).join('/');
};

const createCoverageEntryMap = (summary) => {
  const entries = Object.entries(summary ?? {});
  const coverageMap = new Map();

  for (const [modulePath, data] of entries) {
    if (modulePath === 'total') {
      continue;
    }

    const normalizedPath = normalizeModulePath(modulePath);
    coverageMap.set(normalizedPath, data);
  }

  return coverageMap;
};

const assertModuleCoverage = (summary, baseline) => {
  const requirements = baseline?.requirements;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('coverage-baseline.json must include at least one requirement entry.');
  }

  const coverageMap = createCoverageEntryMap(summary);

  for (const requirement of requirements) {
    const { module, minLineCoverage } = requirement ?? {};
    if (typeof module !== 'string' || module.trim() === '') {
      throw new Error('Each coverage requirement must specify a module path.');
    }
    if (typeof minLineCoverage !== 'number' || Number.isNaN(minLineCoverage)) {
      throw new Error(`Coverage requirement for ${module} is missing a numeric minLineCoverage value.`);
    }

    const normalizedModule = normalizeModulePath(module);
    const coverageEntry = coverageMap.get(normalizedModule);
    if (!coverageEntry) {
      throw new Error(
        `Coverage summary is missing metrics for ${normalizedModule}. Ensure vitest collects coverage for this module.`,
      );
    const coverageEntry = summary?.[module];
    if (!coverageEntry) {
      throw new Error(`Coverage summary is missing metrics for ${module}. Ensure vitest collects coverage for this module.`);
    }

    const actualPct = coverageEntry?.lines?.pct;
    if (typeof actualPct !== 'number' || Number.isNaN(actualPct)) {
      throw new Error(`Coverage data for ${normalizedModule} is missing line percentage information.`);
      throw new Error(`Coverage data for ${module} is missing line percentage information.`);
    }

    if (actualPct < minLineCoverage) {
      throw new Error(
        `Module ${normalizedModule} line coverage ${formatPct(actualPct)} is below the required ${formatPct(minLineCoverage)} threshold.`,
      );
    }

    console.log(
      `Module ${normalizedModule} meets line coverage ${formatPct(actualPct)} / ${formatPct(minLineCoverage)} requirement.`,
    );
        `Module ${module} line coverage ${formatPct(actualPct)} is below the required ${formatPct(minLineCoverage)} threshold.`,
      );
    }

    console.log(`Module ${module} meets line coverage ${formatPct(actualPct)} / ${formatPct(minLineCoverage)} requirement.`);
  }
};

const run = async () => {
  const summary = await parseJsonFile(COVERAGE_FILE, 'Coverage summary');
  const baseline = await parseJsonFile(BASELINE_FILE, 'Coverage baseline');

  assertTotalCoverage(summary);
  assertModuleCoverage(summary, baseline);
};

export { createCoverageEntryMap, normalizeModulePath, run };

const executedViaCli = () => {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPoint).href;
};

if (executedViaCli()) {
  run().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
run().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
