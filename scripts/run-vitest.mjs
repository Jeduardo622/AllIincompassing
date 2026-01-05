#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const rawArgs = process.argv.slice(2);
const filteredArgs = [];
const positionalArgs = [];
let grepPattern;

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === '--runInBand' || arg === '--run-in-band') {
    continue;
  }
  if (arg === '--grep') {
    const pattern = rawArgs[index + 1];
    if (pattern) {
      filteredArgs.push('--testNamePattern', pattern);
      grepPattern = pattern;
      index += 1;
    }
    continue;
  }
  if (arg.startsWith('--grep=')) {
    const pattern = arg.slice('--grep='.length);
    filteredArgs.push(`--testNamePattern=${pattern}`);
    grepPattern = pattern;
    continue;
  }
  filteredArgs.push(arg);
}

if (grepPattern?.toLowerCase().includes('route guard')) {
  positionalArgs.push(
    'src/components/__tests__/RoleGuard.test.tsx',
    'src/server/routes/__tests__/guards.test.ts',
  );
}

const vitestBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
if (process.env.DEBUG_VITEST_ARGS === '1') {
  console.error('[vitest-runner] args ->', filteredArgs);
}

const child = spawn(vitestBin, ['vitest', 'run', ...positionalArgs, ...filteredArgs], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
  shell: process.platform === 'win32',
});

const HANG_TIMEOUT_MS = Number(process.env.VITEST_HANG_TIMEOUT_MS ?? 45_000);
let lastOutputChunk = '';
let lastSpec = null;
let hangTimer;
let hangDetected = false;

const resetHangTimer = () => {
  if (HANG_TIMEOUT_MS <= 0) {
    return;
  }
  clearTimeout(hangTimer);
  hangTimer = setTimeout(() => {
    hangDetected = true;
    const suspect = lastSpec ?? 'unknown test file';
    console.error(
      `\n[vitest-runner] No test output for ${HANG_TIMEOUT_MS / 1000}s. Suspected hanging spec: ${suspect}`,
    );
    console.error('[vitest-runner] Killing Vitest process...');
    child.kill();
    setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, HANG_TIMEOUT_MS);
};

const parseLines = (data) => {
  lastOutputChunk += data;
  const lines = lastOutputChunk.split(/\r?\n/);
  lastOutputChunk = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('❯ ')) {
      const candidate = trimmed.slice(2).split(/\s+/)[0];
      if (candidate) {
        lastSpec = candidate;
      }
    }
  }
};

const forwardStream = (source, target) => {
  source.on('data', (chunk) => {
    target.write(chunk);
    parseLines(chunk.toString());
    resetHangTimer();
  });
};

forwardStream(child.stdout, process.stdout);
forwardStream(child.stderr, process.stderr);
resetHangTimer();

child.on('exit', (code) => {
  clearTimeout(hangTimer);
  if (hangDetected) {
    const suggestion = lastSpec ? `npx vitest run ${lastSpec}` : 'npx vitest run --runInBand';
    console.error(`[vitest-runner] Suggested follow-up: ${suggestion}`);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  clearTimeout(hangTimer);
  console.error('Failed to launch vitest:', error);
  process.exit(1);
});
