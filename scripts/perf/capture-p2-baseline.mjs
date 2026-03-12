import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "reports");
const OUT_PATH = path.join(OUT_DIR, "p2-baseline-metrics.json");

const SCHEDULE_FILE = path.join(ROOT, "src", "pages", "Schedule.tsx");
const ROUTE_REFETCH_FILE = path.join(ROOT, "src", "lib", "useRouteQueryRefetch.ts");
const REPORTS_SUMMARY_FILE = path.join(ROOT, "src", "components", "Dashboard", "ReportsSummary.tsx");
const REPORTS_FILE = path.join(ROOT, "src", "pages", "Reports.tsx");

const DAY_SLOTS = [];
for (let hour = 8; hour < 18; hour += 1) {
  for (let minute = 0; minute < 60; minute += 15) {
    DAY_SLOTS.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
}

const toIso = (dayIndex, slotIndex) => {
  const base = new Date(Date.UTC(2026, 2, 1 + dayIndex, 8, 0, 0, 0));
  const minutes = slotIndex * 15;
  base.setUTCMinutes(base.getUTCMinutes() + minutes);
  return base.toISOString();
};

const buildSyntheticSessions = (days, sessionsPerDay) => {
  const sessions = [];
  for (let day = 0; day < days; day += 1) {
    for (let i = 0; i < sessionsPerDay; i += 1) {
      const slotIndex = i % DAY_SLOTS.length;
      const startIso = toIso(day, slotIndex);
      sessions.push({
        id: `session-${day}-${i}`,
        start_time: startIso,
        status: i % 4 === 0 ? "completed" : "scheduled",
        therapist_id: `therapist-${i % 8}`,
        client_id: `client-${i % 32}`,
      });
    }
  }
  return sessions;
};

const legacySlotFilterBenchmark = (sessions, days) => {
  const weekDates = Array.from({ length: days }, (_, idx) => {
    const date = new Date(Date.UTC(2026, 2, 1 + idx));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });

  let totalMatches = 0;
  const t0 = performance.now();
  for (const dayKey of weekDates) {
    for (const slot of DAY_SLOTS) {
      const matches = sessions.filter((session) => {
        const rawDate = session.start_time.slice(0, 10);
        const rawTime = session.start_time.slice(11, 16);
        return rawDate === dayKey && rawTime === slot;
      });
      totalMatches += matches.length;
    }
  }
  const t1 = performance.now();
  return {
    durationMs: Number((t1 - t0).toFixed(2)),
    totalMatches,
    comparisons: sessions.length * weekDates.length * DAY_SLOTS.length,
  };
};

const countMatches = (text, regex) => (text.match(regex) ?? []).length;

const run = async () => {
  const [scheduleText, routeRefetchText, reportsSummaryText, reportsText] = await Promise.all([
    readFile(SCHEDULE_FILE, "utf8"),
    readFile(ROUTE_REFETCH_FILE, "utf8"),
    readFile(REPORTS_SUMMARY_FILE, "utf8"),
    readFile(REPORTS_FILE, "utf8"),
  ]);

  const syntheticSessions = buildSyntheticSessions(6, 220);
  const scheduleBenchmark = legacySlotFilterBenchmark(syntheticSessions, 6);

  const wildcardSelects = countMatches(
    `${reportsSummaryText}\n${reportsText}`,
    /\.select\(\s*`?\s*\*/g,
  );

  const payloadRiskSignals = {
    reportsRawDataExport: reportsText.includes("rawData"),
    reportsSummaryWildcardSessionFetch: reportsSummaryText.includes(".from('sessions')") && reportsSummaryText.includes(".select('*')"),
    reportsSummaryWildcardTherapistFetch: reportsSummaryText.includes(".from('therapists')") && reportsSummaryText.includes(".select('*')"),
  };

  const globalInvalidation = routeRefetchText.includes("invalidateQueries({ refetchType: 'active' })");

  const report = {
    capturedAt: new Date().toISOString(),
    baseline: {
      schedule: {
        syntheticSessions: syntheticSessions.length,
        slotsPerDay: DAY_SLOTS.length,
        days: 6,
        legacySlotFilter: scheduleBenchmark,
      },
      queries: {
        globalRouteInvalidationEnabled: globalInvalidation,
      },
      payload: {
        wildcardSelectCountInDashboardReportsPaths: wildcardSelects,
        riskSignals: payloadRiskSignals,
      },
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`P2 baseline metrics written to ${path.relative(ROOT, OUT_PATH)}`);
};

run().catch((error) => {
  console.error("Failed to capture P2 baseline metrics");
  console.error(error);
  process.exitCode = 1;
});
