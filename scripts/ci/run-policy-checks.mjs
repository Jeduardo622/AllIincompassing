import { spawnSync } from 'node:child_process';

const checks = [
  ['node', ['scripts/ci/check-focused-tests.mjs']],
  ['node', ['scripts/ci/check-startup-canary.mjs']],
  ['node', ['scripts/ci/check-api-boundary.mjs']],
  ['node', ['scripts/ci/check-api-contract-smoke.mjs']],
  ['node', ['scripts/ci/check-api-convergence.mjs']],
  ['node', ['scripts/ci/check-auth-invariants.mjs']],
  ['node', ['scripts/ci/check-supabase-function-auth-parity.mjs']],
  ['node', ['scripts/ci/check-rls-policy-coverage.mjs']],
  ['node', ['scripts/ci/check-rls-policy-overlap.mjs']],
  ['node', ['scripts/ci/check-migration-governance.mjs']],
  ['node', ['scripts/ci/check-test-reliability.mjs']],
  ['node', ['scripts/ci/check-architecture-pack-freshness.mjs']],
  ['node', ['scripts/ci/check-repo-hygiene.mjs']],
];

const run = (command, args) =>
  spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

const shouldSendSlackAlert = () =>
  process.env.CI === 'true' && typeof process.env.SLACK_WEBHOOK_URL === 'string' && process.env.SLACK_WEBHOOK_URL.trim() !== '';

const notifyFailure = (failedCommand) => {
  if (!shouldSendSlackAlert()) {
    return;
  }

  const ref = process.env.GITHUB_REF || process.env.GITHUB_REF_NAME || 'unknown-ref';
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
    : `run-id:${runId}`;

  const args = [
    'run',
    'alert:slack',
    '--',
    '--title',
    'CI policy checks failed',
    '--text',
    `Policy checks failed on ${ref}. Failed command: ${failedCommand}. Workflow: ${runUrl}`,
    '--severity',
    'medium',
    '--source',
    'ci:check-focused',
    '--runbook',
    'docs/INCIDENT_RESPONSE.md',
  ];

  const result = run('npm', args);
  if (result.status !== 0) {
    console.warn('⚠️ Failed to send CI Slack alert after policy-check failure.');
  }
};

for (const [command, args] of checks) {
  const result = run(command, args);
  if (result.status !== 0) {
    notifyFailure(`${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

console.log('All policy checks passed.');
