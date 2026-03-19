const isCi = process.env.CI === 'true';
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const configuredProtectedBranches = process.env.CI_PROTECTED_BRANCHES ?? '';
const expectedBranches = (
  configuredProtectedBranches.trim().length > 0
    ? configuredProtectedBranches
    : (process.env.CI_PROTECTED_BRANCH ?? 'main')
)
  .split(',')
  .map((branch) => branch.trim())
  .filter((branch) => branch.length > 0);
const requiredChecks = (process.env.CI_REQUIRED_CHECKS ?? 'quality')
  .split(',')
  .map((check) => check.trim())
  .filter((check) => check.length > 0);
const maxAttempts = 3;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

const logSkip = (message) => {
  console.warn(`⚠️ ${message}`);
};

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (url, options) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url, options);
    if (!retryableStatuses.has(response.status) || attempt >= maxAttempts) {
      return response;
    }
    const backoffMs = 200 * Math.pow(2, attempt - 1);
    await sleep(backoffMs);
  }

  return fetch(url, options);
};

const extractRequiredCheckContexts = (branch) => {
  const legacyContexts = Array.isArray(branch?.protection?.required_status_checks?.contexts)
    ? branch.protection.required_status_checks.contexts
    : [];
  const modernChecks = Array.isArray(branch?.protection?.required_status_checks?.checks)
    ? branch.protection.required_status_checks.checks
      .map((check) => check?.context)
      .filter((context) => typeof context === 'string' && context.trim().length > 0)
    : [];

  return [...new Set([...legacyContexts, ...modernChecks])];
};

const validateBranch = async (expectedBranch, makeHeaders) => {
  const url = `https://api.github.com/repos/${repository}/branches/${expectedBranch}`;
  const response = await fetchWithRetry(url, {
    headers: makeHeaders(),
  });

  if (!response.ok) {
    const detail = await response.text();
    fail(
      `Failed to fetch branch metadata for ${expectedBranch} (${response.status}): ${detail}`,
    );
  }

  const branch = await response.json();
  if (branch.protected !== true) {
    fail(
      `Branch ${expectedBranch} is not protected. Enable branch protection and required checks before release.`,
    );
  }

  const contexts = extractRequiredCheckContexts(branch);
  if (contexts.length === 0) {
    fail(
      `Branch ${expectedBranch} protection is missing required status checks. Expected: ${requiredChecks.join(
        ', ',
      )}.`,
    );
  }

  const missing = requiredChecks.filter((check) => !contexts.includes(check));
  if (missing.length > 0) {
    fail(
      `Branch ${expectedBranch} is missing required checks: ${missing.join(
        ', ',
      )}. Current checks: ${contexts.join(', ') || '(none)'}.`,
    );
  }

  console.log(
    `Branch protection check passed for ${expectedBranch}. Required checks present: ${requiredChecks.join(', ')}.`,
  );
};

const run = async () => {
  if (!isCi) {
    logSkip('Branch protection check skipped outside CI.');
    return;
  }

  if (expectedBranches.length === 0) {
    fail(
      'No protected branches configured. Set CI_PROTECTED_BRANCH or CI_PROTECTED_BRANCHES to at least one branch name.',
    );
  }

  if (!repository) {
    fail('GITHUB_REPOSITORY is required for branch protection checks.');
  }

  if (!token) {
    fail('GITHUB_TOKEN is required for branch protection checks.');
  }

  const makeHeaders = () => ({
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-GitHub-Api-Version': '2022-11-28',
  });

  for (const expectedBranch of expectedBranches) {
    await validateBranch(expectedBranch, makeHeaders);
  }
};

run().catch((error) => {
  fail(`Branch protection check failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
});
