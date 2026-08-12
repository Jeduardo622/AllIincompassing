import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const contractPath = path.join(
  process.cwd(),
  "scripts",
  "payroll-timesheet-derive-contract.mjs",
);
const reportPath = path.join(
  process.cwd(),
  ".superpowers",
  "sdd",
  "2026-08-11-payroll-grade-timekeeping",
  "task-3-fix-round-1f-performance-report.md",
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8")
  : "";
const report = existsSync(reportPath)
  ? readFileSync(reportPath, "utf8")
  : "";
const artifactReference = report.match(
  /`(reports\/evidence\/payroll-timesheet-derive-contract-1f-[^`]+\.json)`/,
)?.[1];

describe("payroll timesheet derive contract", () => {
  it("wires a loopback-only runtime harness for append-only payroll snapshot performance proof", () => {
    expect(packageJson.scripts?.["payroll:timesheet-derive-contract"]).toBe(
      "node scripts/payroll-timesheet-derive-contract.mjs",
    );
    expect(contract).toContain("PAYROLL_LOCAL_DATABASE_URL");
    expect(contract).toContain("parsed.hostname === \"127.0.0.1\"");
    expect(contract).toContain("parsed.port === \"54322\"");
    expect(contract).toContain("parsed.pathname === \"/postgres\"");
    expect(contract).toContain("exact local Supabase loopback database");
    expect(contract).toContain("ROLLBACK");
    expect(contract).toContain("[0, 50, 200, 500]");
    expect(contract).toContain("set_config('request.jwt.claims'");
    expect(contract).toContain("set local role authenticated");
    expect(contract).toContain("update public.organization_feature_flags");
    expect(contract).toContain("flag_key = 'payroll_timekeeping_v1'");
    expect(contract).not.toContain("delete from public.employee_time_events");
    expect(contract).not.toContain("update public.employee_time_events");
    expect(contract).toContain("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)");
    expect(contract).not.toContain("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select public.derive_timesheet_snapshot");
    expect(contract).toContain("selectedLocalDate");
    expect(contract).toContain("select public.derive_timesheet_snapshot($1::date, $2::text) as result");
    expect(contract).toContain("sourcePlans");
    expect(contract).toContain("indexUse");
    expect(contract).toContain("rpcWallMs");
    expect(contract).toContain("rpcOutcome");
    expect(contract).toContain("expectedBlocker");
    expect(contract).toContain("assertSuccessfulRpcResult(result)");
    expect(contract).toContain("reports");
    expect(contract).toContain("reports/evidence");
    expect(contract).toContain("employee_time_events_org_employment_event_at_idx");
    expect(contract).toContain("timesheet_meal_resolutions");
    expect(contract).toContain("payroll_mutation_receipts");
    expect(report).toContain("Artifact:");
    expect(report).toContain("Plan/index observations");
    expect(report).toContain("Timings");
    expect(report).toContain("Concerns");
  });

  it("binds the report to structured evidence for every successful bucket", () => {
    expect(artifactReference).toBeTruthy();
    const artifactPath = path.join(process.cwd(), artifactReference!);
    expect(existsSync(artifactPath)).toBe(true);

    const evidence = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      success: boolean;
      artifactVersion: string;
      databaseTarget: { host: string; port: number; database: string };
      buckets: Array<{
        bucketRowCount: number;
        rpcOutcome: string;
      rpcWallMs: number;
        sourcePlans: Array<{
          queryFamily: string;
          planSummary: {
            actualRows: number;
            planningTimeMs: number;
            executionTimeMs: number;
            indexNames: string[];
            nodeTypes: string[];
            sequentialScans: unknown[];
          };
        }>;
        indexUse: Record<string, string[]>;
        rpcResultSummary: {
          state: string;
          sourceHash: string;
          snapshotId: string;
          replayed: boolean;
          lockable?: never;
        };
      }>;
    };

    expect(evidence).toMatchObject({
      success: true,
      artifactVersion: "task-3-fix-round-1f",
      databaseTarget: { host: "127.0.0.1", port: 54322, database: "postgres" },
    });
    expect(evidence.buckets.map((bucket) => bucket.bucketRowCount)).toEqual([
      0,
      50,
      200,
      500,
    ]);

    for (const bucket of evidence.buckets) {
      expect(bucket.rpcOutcome).toBe("success");
      expect(bucket.rpcResultSummary).toMatchObject({
        state: "ok",
        sourceHash: expect.stringMatching(/^[0-9a-f]{64}$/i),
        snapshotId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        replayed: false,
      });
      expect(bucket.rpcResultSummary).not.toHaveProperty("lockable");
      expect(bucket.rpcWallMs).toBeGreaterThan(0);
      expect(bucket.sourcePlans).toHaveLength(4);
      expect(bucket.sourcePlans.map((plan) => plan.queryFamily)).toEqual([
        "employeeTimeEvents",
        "timeCorrectionRequests",
        "mealResolutions",
        "payrollMutationReceipts",
      ]);
      expect(bucket.indexUse.employeeTimeEvents).toContain(
        "employee_time_events_org_employment_event_at_idx",
      );
      for (const plan of bucket.sourcePlans) {
        expect(plan.planSummary.planningTimeMs).toBeGreaterThanOrEqual(0);
        expect(plan.planSummary.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(plan.planSummary.nodeTypes.length).toBeGreaterThan(0);
        expect(Array.isArray(plan.planSummary.sequentialScans)).toBe(true);
        expect(bucket.indexUse[plan.queryFamily]).toEqual(plan.planSummary.indexNames);
      }
      expect(bucket.sourcePlans[0].planSummary.actualRows).toBe(bucket.bucketRowCount);
      expect(bucket.sourcePlans[1].planSummary.actualRows).toBe(0);
      expect(bucket.sourcePlans[2].planSummary.actualRows).toBe(0);
      expect(bucket.sourcePlans[3].planSummary.actualRows).toBe(1);
      expect(report).toContain(
        `| ${bucket.bucketRowCount} | success | ${bucket.rpcWallMs.toFixed(3)} ms |`,
      );
    }
  });
});
