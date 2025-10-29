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
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Failed to launch vitest:', error);
  process.exit(1);
});
