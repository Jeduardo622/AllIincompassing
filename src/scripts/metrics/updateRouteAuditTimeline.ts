import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface TimelineEntry {
  readonly item: string;
  readonly effort: 'S' | 'M' | 'L';
  readonly start: string;
  readonly end: string;
  readonly deps: readonly string[];
}

type CliArgs = Record<string, string | boolean>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const TIMELINE_PATH = path.join(PROJECT_ROOT, 'reports', 'timeline.json');

const BASE_ITEM = 'Compliance dashboard automation';
const WEEKLY_PREFIX = 'Weekly route audit –';

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const [rawKey, rawValue] = token.split('=');
    const key = rawKey.replace(/^--/, '');
    if (rawValue !== undefined) {
      args[key] = rawValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const toDate = (value: string | undefined): Date | undefined =>
  value ? new Date(value) : undefined;

const formatDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const resolveStartDate = (args: CliArgs): Date => {
  const explicit = toDate(typeof args.start === 'string' ? args.start : undefined);
  if (explicit instanceof Date && !Number.isNaN(explicit.valueOf())) {
    return explicit;
  }

  const today = new Date();
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = candidate.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  return addDays(candidate, daysUntilMonday);
};

const ensureBaseEntry = (
  entries: TimelineEntry[],
  baseStart: Date,
  baseEnd: Date
): TimelineEntry[] => {
  const hasBase = entries.some(entry => entry.item === BASE_ITEM);
  if (hasBase) {
    return entries;
  }

  const baseEntry: TimelineEntry = {
    item: BASE_ITEM,
    effort: 'S',
    start: formatDate(baseStart),
    end: formatDate(baseEnd),
    deps: []
  };

  return [...entries, baseEntry];
};

const buildWeeklyEntries = (
  startDate: Date,
  weeks: number,
  dependency: string
): TimelineEntry[] => {
  const weeklyEntries: TimelineEntry[] = [];
  for (let index = 0; index < weeks; index += 1) {
    const start = addDays(startDate, index * 7);
    const end = addDays(start, 4);
    const label = `${WEEKLY_PREFIX} Week ${index + 1}`;
    weeklyEntries.push({
      item: label,
      effort: 'S',
      start: formatDate(start),
      end: formatDate(end),
      deps: [dependency]
    });
  }
  return weeklyEntries;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const weeks = typeof args.weeks === 'string' ? Number(args.weeks) : 6;
  if (!Number.isFinite(weeks) || weeks <= 0) {
    throw new Error('Expected --weeks to be a positive number.');
  }

  const startDate = resolveStartDate(args);
  const timelineRaw = readFileSync(TIMELINE_PATH, 'utf-8');
  const timeline = JSON.parse(timelineRaw) as TimelineEntry[];

  const baseStart = addDays(startDate, -2);
  const baseEnd = addDays(startDate, -1);

  const withoutWeekly = timeline.filter(entry => !entry.item.startsWith(WEEKLY_PREFIX));
  const withBase = ensureBaseEntry(withoutWeekly, baseStart, baseEnd);

  const weeklyEntries = buildWeeklyEntries(startDate, weeks, BASE_ITEM);
  const merged = [...withBase, ...weeklyEntries].sort((a, b) =>
    a.start.localeCompare(b.start)
  );

  writeFileSync(TIMELINE_PATH, `${JSON.stringify(merged, null, 2)}\n`);

  process.stdout.write(
    [
      'Route audit timeline updated.',
      `- Weekly audits scheduled: ${weeks}`,
      `- First audit window: ${formatDate(startDate)} – ${formatDate(addDays(startDate, 4))}`,
      `- Timeline entries total: ${merged.length}`
    ].join('\n') + '\n'
  );
};

try {
  main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown error updating timeline';
  process.stderr.write(`❌ Failed to update timeline: ${message}\n`);
  process.exitCode = 1;
}
