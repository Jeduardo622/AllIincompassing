#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';

const CRASH_POINTS = [
  'before_claim',
  'after_claim',
  'before_effect',
  'after_effect_before_record',
  'after_record_before_transition',
  'after_transition_before_archive',
  'during_event_append',
];
const RECOVERY_MARKERS = ['effect_already_applied', 'postcondition_not_met'];

function parseArgs(argv) {
  let seed = 'task10-default-seed';
  let crashPoint = null;
  let list = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed' && argv[index + 1]) {
      seed = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--crash-point' && argv[index + 1]) {
      crashPoint = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--list-crash-points') {
      list = true;
    }
  }

  return { seed, crashPoint, list };
}

const { seed, crashPoint, list } = parseArgs(process.argv.slice(2));

if (list) {
  for (const point of CRASH_POINTS) {
    console.log(point);
  }
  process.exit(0);
}

if (crashPoint && !CRASH_POINTS.includes(crashPoint)) {
  console.error(`Unknown crash point: ${crashPoint}`);
  process.exit(2);
}

console.log(`[agent-work-chaos] seed=${seed}`);
const orderedCrashPoints = crashPoint
  ? [crashPoint]
  : CRASH_POINTS.map((point, index) => ({
      point,
      sortKey: Number.parseInt(
        createHash('sha256').update(`${seed}:${point}:${index}`).digest('hex').slice(0, 8),
        16,
      ),
    }))
    .sort((left, right) => left.sortKey - right.sortKey)
    .map((entry) => entry.point);

console.log(
  `[agent-work-chaos] crash-points=${orderedCrashPoints.join(',')}`,
);

const args = ['test', '--allow-env', 'supabase/functions/agent-work-runner/chaos.test.ts'];
if (crashPoint) {
  args.push('--filter', crashPoint);
}

const result = spawnSync('deno', args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENT_WORK_CHAOS_SEED: seed,
    AGENT_WORK_CHAOS_CRASH_POINTS: orderedCrashPoints.join(','),
  },
});

process.exit(result.status ?? 1);
