import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "reports", "p2-baseline-metrics.json");
const OUT_PATH = path.join(ROOT, "reports", "p2-performance-metrics.json");

const SCHEDULE_PATH = path.join(ROOT, "src", "pages", "Schedule.tsx");
const ROUTE_REFETCH_PATH = path.join(ROOT, "src", "lib", "useRouteQueryRefetch.ts");
const REPORTS_SUMMARY_PATH = path.join(ROOT, "src", "components", "Dashboard", "ReportsSummary.tsx");
const REPORTS_PATH = path.join(ROOT, "src", "pages", "Reports.tsx");
const SESSIONS_FN_PATH = path.join(ROOT, "supabase", "functions", "get-sessions-optimized", "index.ts");

const DAY_SLOTS = [];
for (let hour = 8; hour < 18; hour += 1) {
  for (let minute = 0; minute < 60; minute += 15) {
    DAY_SLOTS.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
}

const toIso = (dayIndex, slotIndex) => {
  const base = new Date(Date.UTC(2026, 2, 1 + dayIndex, 8, 0, 0, 0));
  base.setUTCMinutes(base.getUTCMinutes() + (slotIndex * 15));
  return base.toISOString();
};

const buildSyntheticSessions = (days, sessionsPerDay) => {
  const sessions = [];
  for (let day = 0; day < days; day += 1) {
    for (let i = 0; i < sessionsPerDay; i += 1) {
      const slotIndex = i % DAY_SLOTS.length;
      sessions.push({
        id: `session-${day}-${i}`,
        start_time: toIso(day, slotIndex),
      });
    }
  }
  return sessions;
};

const countMatches = (text, regex) => (text.match(regex) ?? []).length;

const legacyBenchmark = (sessions, days) => {
  const weekDates = Array.from({ length: days }, (_, idx) => {
    const date = new Date(Date.UTC(2026, 2, 1 + idx));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });

  const t0 = performance.now();
  for (const dayKey of weekDates) {
    for (const slot of DAY_SLOTS) {
      sessions.filter((session) => session.start_time.slice(0, 10) === dayKey && session.start_time.slice(11, 16) === slot);
    }
  }
  const t1 = performance.now();
  return Number((t1 - t0).toFixed(2));
};

const indexedBenchmark = (sessions, days) => {
  const weekDates = Array.from({ length: days }, (_, idx) => {
    const date = new Date(Date.UTC(2026, 2, 1 + idx));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });

  const index = new Map();
  for (const session of sessions) {
    const key = `${session.start_time.slice(0, 10)}|${session.start_time.slice(11, 16)}`;
    const existing = index.get(key);
    if (existing) {
      existing.push(session);
    } else {
      index.set(key, [session]);
    }
  }

  const t0 = performance.now();
  for (const dayKey of weekDates) {
    for (const slot of DAY_SLOTS) {
      index.get(`${dayKey}|${slot}`) ?? [];
    }
  }
  const t1 = performance.now();
  return Number((t1 - t0).toFixed(2));
};

const percentageImprovement = (baseline, current) => {
  if (baseline <= 0) return 0;
  return Number((((baseline - current) / baseline) * 100).toFixed(2));
};

const run = async () => {
  const [baselineRaw, scheduleText, routeRefetchText, reportsSummaryText, reportsText, sessionsFnText] = await Promise.all([
    readFile(BASELINE_PATH, "utf8"),
    readFile(SCHEDULE_PATH, "utf8"),
    readFile(ROUTE_REFETCH_PATH, "utf8"),
    readFile(REPORTS_SUMMARY_PATH, "utf8"),
    readFile(REPORTS_PATH, "utf8"),
    readFile(SESSIONS_FN_PATH, "utf8"),
  ]);

  const baseline = JSON.parse(baselineRaw);
  const baselineDuration = Number(baseline?.baseline?.schedule?.legacySlotFilter?.durationMs ?? 0);
  const baselineWildcardSelects = Number(baseline?.baseline?.payload?.wildcardSelectCountInDashboardReportsPaths ?? 0);

  const syntheticSessions = buildSyntheticSessions(6, 220);
  const currentLegacyDuration = legacyBenchmark(syntheticSessions, 6);
  const currentIndexedDuration = indexedBenchmark(syntheticSessions, 6);
  const indexedImprovement = percentageImprovement(currentLegacyDuration, currentIndexedDuration);

  const wildcardSelects = countMatches(
    `${reportsSummaryText}\n${reportsText}`,
    /\.select\(\s*`?\s*\*/g,
  );

  const hasGlobalInvalidate = routeRefetchText.includes("invalidateQueries({ refetchType: 'active' })");
  const hasCursorPagination = sessionsFnText.includes("cursor") && sessionsFnText.includes("nextCursor");
  const hasSqlSummary = sessionsFnText.includes("get_session_metrics");
  const hasSlotIndexing = scheduleText.includes("buildSessionSlotIndex(");
  const hasBoundedConcurrency = scheduleText.includes("AUTO_SCHEDULE_CONCURRENCY");

  const baselineToCurrentImprovement = percentageImprovement(baselineDuration || currentLegacyDuration, currentIndexedDuration);
  const wildcardReduction = baselineWildcardSelects - wildcardSelects;

  const report = {
    capturedAt: new Date().toISOString(),
    baseline: {
      scheduleDurationMs: baselineDuration,
      wildcardSelectCount: baselineWildcardSelects,
    },
    current: {
      syntheticLegacyDurationMs: currentLegacyDuration,
      syntheticIndexedDurationMs: currentIndexedDuration,
      indexedImprovementPercent: indexedImprovement,
      baselineToCurrentScheduleImprovementPercent: baselineToCurrentImprovement,
      wildcardSelectCount: wildcardSelects,
      wildcardReduction,
      globalRouteInvalidationEnabled: hasGlobalInvalidate,
      hasCursorPagination,
      hasSqlSummary,
      hasSlotIndexing,
      hasBoundedConcurrency,
    },
  };

  const failures = [];
  if (baselineToCurrentImprovement < 25) {
    failures.push(`Schedule synthetic p95 proxy improvement below target (required >=25%, got ${baselineToCurrentImprovement}%).`);
  }
  if (wildcardSelects > 0) {
    failures.push(`Wildcard select usage remains in dashboard/report paths (${wildcardSelects} occurrences).`);
  }
  if (hasGlobalInvalidate) {
    failures.push("Global route invalidation is still enabled in useRouteQueryRefetch.");
  }
  if (!hasCursorPagination) {
    failures.push("Sessions optimized function does not expose cursor-based pagination contract.");
  }
  if (!hasSqlSummary) {
    failures.push("Sessions optimized function does not use SQL aggregation for summary metrics.");
  }
  if (!hasSlotIndexing || !hasBoundedConcurrency) {
    failures.push("Schedule hot-path optimization markers missing (slot indexing or bounded concurrency).");
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(report, null, 2), "utf8");

  if (failures.length > 0) {
    console.error("P2 performance check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`P2 performance check passed. Report written to ${path.relative(ROOT, OUT_PATH)}`);
};

run().catch((error) => {
  console.error("P2 performance check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
