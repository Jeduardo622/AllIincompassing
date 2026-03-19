const isCi = process.env.CI === 'true';
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const expectedBranch = process.env.CI_PROTECTED_BRANCH ?? 'main';
const requiredChecks = (process.env.CI_REQUIRED_CHECKS ?? 'quality')
  .split(',')
  .map((check) => check.trim())
  .filter((check) => check.length > 0);

const logSkip = (message) => {
  console.warn(`⚠️ ${message}`);
};

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const run = async () => {
  if (!isCi) {
    logSkip('Branch protection check skipped outside CI.');
    return;
  }

  if (!repository) {
    fail('GITHUB_REPOSITORY is required for branch protection checks.');
  }

  if (!token) {
    fail('GITHUB_TOKEN is required for branch protection checks.');
  }

  const url = `https://api.github.com/repos/${repository}/branches/${expectedBranch}`;
  const makeHeaders = () => ({
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-GitHub-Api-Version': '2022-11-28',
  });

  let response = await fetch(url, {
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

  const contexts = branch?.protection?.required_status_checks?.contexts;
  if (!Array.isArray(contexts)) {
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
    `Main branch protection check passed. Required checks present: ${requiredChecks.join(', ')}.`,
  );
};

run().catch((error) => {
  fail(`Branch protection check failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
});
