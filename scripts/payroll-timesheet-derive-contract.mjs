import pg from "pg";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const { Client } = pg;

const PERIOD_START = "2026-08-11";
const PERIOD_END = "2026-08-17";
const PERIOD_START_TS = `${PERIOD_START}T16:00:00Z`;
const REPORTS_SUBDIR = "reports/evidence";
const SMOKE_SQL_PATH = path.join(
  process.cwd(),
  "tests",
  "sql",
  "payroll_timekeeping_foundation_smoke.sql",
);
const FIXTURE_IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000011",
  userB: "10000000-0000-4000-8000-000000000012",
  employmentA: "10000000-0000-4000-8000-000000000041",
  employmentB: "10000000-0000-4000-8000-000000000042",
  payGroupA: "90000000-0000-4000-8000-000000000002",
  payPeriodA: "90000000-0000-4000-8000-000000000003",
};
const BUCKETS = [
  { rowCount: 0, expectedBlocker: null },
  { rowCount: 50, expectedBlocker: null },
  { rowCount: 200, expectedBlocker: null },
  { rowCount: 500, expectedBlocker: null },
];
const REPORTS_DIR = path.join(process.cwd(), REPORTS_SUBDIR);
const REQUIRED_PLAN_INDEXES = {
  employeeTimeEvents: "employee_time_events_org_employment_event_at_idx",
};

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertSuccessfulRpcResult = (result) => {
  const keys = result && typeof result === "object" && !Array.isArray(result)
    ? Object.keys(result).sort()
    : [];
  assert(
    JSON.stringify(keys) === JSON.stringify(["replayed", "snapshotId", "sourceHash"]),
    `unexpected_rpc_envelope:${keys.join(",") || "missing"}:${JSON.stringify({
      state: result?.state ?? null,
      exceptions: result?.exceptions ?? null,
    })}`,
  );
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.snapshotId),
    "unexpected_rpc_snapshot_id",
  );
  assert(/^[0-9a-f]{64}$/i.test(result.sourceHash), "unexpected_rpc_source_hash");
  assert(result.replayed === false, "unexpected_rpc_replay_state");
};

const runStep = async (label, callback) => {
  try {
    return await callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}:${message}`);
  }
};

const readTransactionalSmokeFixture = async () =>
  (await readFile(SMOKE_SQL_PATH, "utf8"))
    .replace(/^begin;\s*$/im, "")
    .replace(/^commit;\s*$/im, "");

const assertLocalPayrollDatabase = (databaseUrl) => {
  const parsed = new URL(databaseUrl);
  const valid =
    (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
    parsed.hostname === "127.0.0.1" &&
    parsed.port === "54322" &&
    parsed.pathname === "/postgres" &&
    parsed.username === "postgres";
  if (!valid) {
    throw new Error("PAYROLL_LOCAL_DATABASE_URL must target the exact local Supabase loopback database.");
  }
};

const attachDatabaseErrorGuard = (database) => {
  let failure = null;
  database.on("error", () => {
    failure ??= new Error("database_client_failed");
  });
  return () => failure;
};

const bucketUuid = (bucketIndex, slot) =>
  `70000000-0000-4000-8000-${String(bucketIndex * 1000 + slot).padStart(12, "0")}`;

const timestampSlug = () =>
  new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

const collectPlanMetadata = (planNode, summary) => {
  if (!planNode || typeof planNode !== "object") return;

  const nodeType = planNode["Node Type"] ?? "unknown";
  summary.nodeTypes.add(nodeType);

  if (planNode["Index Name"]) {
    summary.indexNames.add(planNode["Index Name"]);
  }

  if (nodeType === "Seq Scan") {
    summary.sequentialScans.push({
      relationName: planNode["Relation Name"] ?? null,
      alias: planNode["Alias"] ?? null,
      actualRows: planNode["Actual Rows"] ?? null,
      planRows: planNode["Plan Rows"] ?? null,
      filter: planNode.Filter ?? null,
    });
  }

  for (const child of planNode.Plans ?? []) {
    collectPlanMetadata(child, summary);
  }
};

const explain = async (database, queryFamily, sql, values) => {
  const { rows } = await database.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    values,
  );
  const plan = rows[0]?.["QUERY PLAN"]?.[0] ?? null;
  assert(plan, `Missing plan output for ${queryFamily}.`);

  const summary = {
    queryFamily,
    rootNodeType: plan.Plan?.["Node Type"] ?? null,
    planningTimeMs: Number(plan["Planning Time"] ?? 0),
    executionTimeMs: Number(plan["Execution Time"] ?? 0),
    indexNames: new Set(),
    nodeTypes: new Set(),
    sequentialScans: [],
    planRows: plan.Plan?.["Plan Rows"] ?? null,
    actualRows: plan.Plan?.["Actual Rows"] ?? null,
    sharedHitBlocks: plan.Plan?.["Shared Hit Blocks"] ?? null,
    sharedReadBlocks: plan.Plan?.["Shared Read Blocks"] ?? null,
  };

  collectPlanMetadata(plan.Plan, summary);

  return {
    queryFamily,
    planSummary: {
      queryFamily,
      rootNodeType: summary.rootNodeType,
      planningTimeMs: summary.planningTimeMs,
      executionTimeMs: summary.executionTimeMs,
      indexNames: [...summary.indexNames].sort(),
      nodeTypes: [...summary.nodeTypes].sort(),
      sequentialScans: summary.sequentialScans,
      planRows: summary.planRows,
      actualRows: summary.actualRows,
      sharedHitBlocks: summary.sharedHitBlocks,
      sharedReadBlocks: summary.sharedReadBlocks,
    },
  };
};

const seedBucketFixture = async (database, bucketIndex, rowCount) => {
  await runStep(
    `bucket:${bucketIndex}:smoke-sql`,
    async () => database.query(await readTransactionalSmokeFixture()),
  );

  await runStep(`bucket:${bucketIndex}:feature-flag`, () => database.query(
    `
      update public.organization_feature_flags org_flag
      set is_enabled = true
      from public.feature_flags flag
      where org_flag.organization_id in ($1::uuid, $2::uuid)
        and org_flag.feature_flag_id = flag.id
        and flag.flag_key = 'payroll_timekeeping_v1'
    `,
    [FIXTURE_IDS.orgA, FIXTURE_IDS.orgB],
  ));

  await runStep(`bucket:${bucketIndex}:pay-group`, () => database.query(
    `
      insert into public.pay_groups (id, organization_id, name, cadence, timezone)
      values ($1::uuid, $2::uuid, 'Weekly Payroll', 'weekly', 'America/Los_Angeles')
    `,
    [FIXTURE_IDS.payGroupA, FIXTURE_IDS.orgA],
  ));

  await runStep(`bucket:${bucketIndex}:pay-group-assignment`, () => database.query(
    `
      insert into public.pay_group_assignments (
        organization_id,
        employment_profile_id,
        pay_group_id,
        effective_from
      )
      values ($1::uuid, $2::uuid, $3::uuid, $4::date)
    `,
    [FIXTURE_IDS.orgA, FIXTURE_IDS.employmentA, FIXTURE_IDS.payGroupA, PERIOD_START],
  ));

  await runStep(`bucket:${bucketIndex}:pay-period`, () => database.query(
    `
      insert into public.pay_periods (
        id,
        organization_id,
        pay_group_id,
        starts_on,
        ends_on
      )
      values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date)
    `,
    [FIXTURE_IDS.payPeriodA, FIXTURE_IDS.orgA, FIXTURE_IDS.payGroupA, PERIOD_START, PERIOD_END],
  ));

  if (rowCount > 0) {
    await runStep(`bucket:${bucketIndex}:target-events`, () => database.query(
      `
        insert into public.employee_time_events (
          organization_id,
          employment_profile_id,
          event_type,
          event_at,
          actor_user_id,
          source_timezone,
          work_location
        )
        select
          $1::uuid,
          $2::uuid,
          pair_row.event_type::public.payroll_event_type,
          pair_row.event_at,
          $3::uuid,
          'America/Los_Angeles',
          'office'::public.work_location
        from generate_series(0, ($4::int / 2) - 1) bucket_pair(pair_index)
        cross join lateral (
          values
            ('shift_started', $5::timestamptz + (bucket_pair.pair_index * interval '2 minutes')),
            ('shift_ended', $5::timestamptz + (bucket_pair.pair_index * interval '2 minutes') + interval '1 minute')
        ) pair_row(event_type, event_at)
      `,
      [FIXTURE_IDS.orgA, FIXTURE_IDS.employmentA, FIXTURE_IDS.userA, rowCount, PERIOD_START_TS],
    ));
  }

  await runStep(`bucket:${bucketIndex}:noise-events`, () => database.query(
    `
      insert into public.employee_time_events (
        organization_id,
        employment_profile_id,
        event_type,
        event_at,
        actor_user_id,
        source_timezone,
        work_location
      )
      select
        $1::uuid,
        $2::uuid,
        pair_row.event_type::public.payroll_event_type,
        pair_row.event_at,
        $3::uuid,
        'America/Los_Angeles',
        'office'::public.work_location
      from generate_series(0, 1999) bucket_pair(pair_index)
      cross join lateral (
        values
          ('shift_started', $4::timestamptz + (bucket_pair.pair_index * interval '2 minutes')),
          ('shift_ended', $4::timestamptz + (bucket_pair.pair_index * interval '2 minutes') + interval '1 minute')
      ) pair_row(event_type, event_at)
    `,
    [FIXTURE_IDS.orgB, FIXTURE_IDS.employmentB, FIXTURE_IDS.userB, PERIOD_START_TS],
  ));

  await database.query("ANALYZE public.employee_time_events");
  await database.query("ANALYZE public.time_correction_requests");
  await database.query("ANALYZE public.timesheet_meal_resolutions");
  await database.query("ANALYZE public.payroll_mutation_receipts");

  const policyVersionId = (
    await database.query(
      `
        select id
        from public.payroll_policy_versions
        where organization_id = $1::uuid
        order by effective_from desc, created_at desc, id desc
        limit 1
      `,
      [FIXTURE_IDS.orgA],
    )
  ).rows[0]?.id ?? null;

  return {
    organizationId: FIXTURE_IDS.orgA,
    actorUserId: FIXTURE_IDS.userA,
    employmentId: FIXTURE_IDS.employmentA,
    payPeriodId: FIXTURE_IDS.payPeriodA,
    policyVersionId,
    selectedLocalDate: "2026-08-13",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    periodStartUtc: `${PERIOD_START}T05:00:00-07:00`,
    periodEndUtc: `${PERIOD_END}T05:00:00-07:00`,
    rowCount,
  };
};

const collectSourceCounts = async (database, fixture) => {
  const { rows } = await database.query(
    `
      select jsonb_build_object(
        'employeeTimeEvents', (
          select count(*)::int
          from public.employee_time_events event_row
          where event_row.organization_id = $1::uuid
            and event_row.employment_profile_id = $2::uuid
            and event_row.event_at >= ($3::date::timestamp at time zone 'America/Los_Angeles')
            and event_row.event_at < (($4::date + 1)::timestamp at time zone 'America/Los_Angeles')
        ),
        'timeCorrectionRequests', (
          select count(*)::int
          from public.time_correction_requests correction_row
          join public.employee_time_events event_row
            on event_row.organization_id = correction_row.organization_id
           and event_row.id = correction_row.original_event_id
          where correction_row.organization_id = $1::uuid
            and correction_row.employment_profile_id = $2::uuid
            and event_row.event_at >= ($3::date::timestamp at time zone 'America/Los_Angeles')
            and event_row.event_at < (($4::date + 1)::timestamp at time zone 'America/Los_Angeles')
        ),
        'mealResolutions', (
          select count(*)::int
          from public.timesheet_meal_resolutions resolution_row
          where resolution_row.organization_id = $1::uuid
            and resolution_row.employment_profile_id = $2::uuid
            and resolution_row.pay_period_id = $5::uuid
        ),
        'payrollMutationReceipts', (
          select count(*)::int
          from public.payroll_mutation_receipts receipt
          where receipt.organization_id = $1::uuid
            and receipt.actor_user_id = $6::uuid
            and receipt.operation = 'derive_timesheet_snapshot'
        )
      ) as counts
    `,
    [
      fixture.organizationId,
      fixture.employmentId,
      fixture.periodStart,
      fixture.periodEnd,
      fixture.payPeriodId,
      fixture.actorUserId,
    ],
  );
  return rows[0]?.counts ?? {};
};

const collectSourcePlans = async (database, fixture, idempotencyKey) => {
  const planFamilies = [
    [
      "employeeTimeEvents",
      `
        select event_row.id
        from public.employee_time_events event_row
        where event_row.organization_id = $1::uuid
          and event_row.employment_profile_id = $2::uuid
          and event_row.event_at >= ($3::date::timestamp at time zone 'America/Los_Angeles')
          and event_row.event_at < (($4::date + 1)::timestamp at time zone 'America/Los_Angeles')
        order by event_row.event_at, event_row.created_at, event_row.id
      `,
      [fixture.organizationId, fixture.employmentId, fixture.periodStart, fixture.periodEnd],
    ],
    [
      "timeCorrectionRequests",
      `
        select correction_row.id
        from public.time_correction_requests correction_row
        join public.employee_time_events event_row
          on event_row.organization_id = correction_row.organization_id
         and event_row.id = correction_row.original_event_id
        where correction_row.organization_id = $1::uuid
          and correction_row.employment_profile_id = $2::uuid
          and event_row.event_at >= ($3::date::timestamp at time zone 'America/Los_Angeles')
          and event_row.event_at < (($4::date + 1)::timestamp at time zone 'America/Los_Angeles')
        order by correction_row.created_at, correction_row.id
      `,
      [fixture.organizationId, fixture.employmentId, fixture.periodStart, fixture.periodEnd],
    ],
    [
      "mealResolutions",
      `
        select resolution_row.id
        from public.timesheet_meal_resolutions resolution_row
        join public.employee_time_events shift_event
          on shift_event.organization_id = resolution_row.organization_id
         and shift_event.employment_profile_id = resolution_row.employment_profile_id
         and shift_event.id = resolution_row.shift_start_event_id
        where resolution_row.organization_id = $1::uuid
          and resolution_row.employment_profile_id = $2::uuid
          and resolution_row.pay_period_id = $3::uuid
        order by shift_event.event_at, resolution_row.meal_ordinal, resolution_row.created_at, resolution_row.id
      `,
      [fixture.organizationId, fixture.employmentId, fixture.payPeriodId],
    ],
    [
      "payrollMutationReceipts",
      `
        select receipt.id
        from public.payroll_mutation_receipts receipt
        where receipt.organization_id = $1::uuid
          and receipt.actor_user_id = $2::uuid
          and receipt.operation = 'derive_timesheet_snapshot'
          and receipt.idempotency_key = $3
      `,
      [fixture.organizationId, fixture.actorUserId, idempotencyKey],
    ],
  ];

  const sourcePlans = [];
  for (const [queryFamily, sql, values] of planFamilies) {
    sourcePlans.push(await explain(database, queryFamily, sql, values));
  }
  return sourcePlans;
};

const assertRequiredPlanIndexes = (bucketResult) => {
  for (const [queryFamily, requiredIndex] of Object.entries(REQUIRED_PLAN_INDEXES)) {
    const plan = bucketResult.sourcePlans.find((candidate) => candidate.queryFamily === queryFamily);
    const actualRows = Number(plan?.planSummary?.actualRows ?? 0);
    if (actualRows > 0) {
      assert(
        plan.planSummary.indexNames.includes(requiredIndex),
        `required_index_missing:${queryFamily}:${requiredIndex}`,
      );
    }
  }
};

const setAuthenticatedContext = async (database, actorUserId) => {
  await database.query("set local role authenticated");
  await database.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "authenticated", sub: actorUserId }),
  ]);
  await database.query("select set_config('request.jwt.claim.sub', $1, true)", [actorUserId]);
  await database.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
};

const runAuthenticatedRpc = async (database, fixture, idempotencyKey) => {
  await setAuthenticatedContext(database, fixture.actorUserId);
  const authProbe = (
    await database.query(
      `
        select
          auth.uid() as actor_id,
          current_user as database_role
      `,
    )
  ).rows[0];
  assert(authProbe?.actor_id === fixture.actorUserId, `auth_probe_actor_mismatch:${JSON.stringify(authProbe)}`);
  assert(authProbe?.database_role === "authenticated", `auth_probe_role_mismatch:${JSON.stringify(authProbe)}`);
  const startedAt = performance.now();
  const { rows } = await database.query(
    "select public.derive_timesheet_snapshot($1::date, $2::text) as result",
    [fixture.selectedLocalDate, idempotencyKey],
  );
  const rpcWallMs = Number((performance.now() - startedAt).toFixed(3));
  await database.query("reset role");

  const result = rows[0]?.result ?? null;
  assertSuccessfulRpcResult(result);
  const rpcOutcome = "success";

  return { rpcWallMs, result, rpcOutcome };
};

const buildBucketResult = async (database, bucketIndex, bucket) => {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL statement_timeout = '60s'");
    await database.query("SET LOCAL synchronous_commit = off");

    const fixture = await runStep(
      `bucket:${bucketIndex}:seed`,
      () => seedBucketFixture(database, bucketIndex, bucket.rowCount),
    );
    const preRpcCounts = await runStep(
      `bucket:${bucketIndex}:counts:before`,
      () => collectSourceCounts(database, fixture),
    );
    const rpcKey = `payroll-timesheet-derive-contract-${bucket.rowCount}`;

    const preRpcPlans = await runStep(
      `bucket:${bucketIndex}:plans:before`,
      () => collectSourcePlans(database, fixture, rpcKey),
    );
    const { rpcWallMs, result, rpcOutcome } = await runStep(
      `bucket:${bucketIndex}:rpc`,
      () => runAuthenticatedRpc(database, fixture, rpcKey),
    );
    const postRpcCounts = await runStep(
      `bucket:${bucketIndex}:counts:after`,
      () => collectSourceCounts(database, fixture),
    );
    const postRpcPlans = await runStep(
      `bucket:${bucketIndex}:plans:after`,
      () => collectSourcePlans(database, fixture, rpcKey),
    );

    const sourcePlans = [...preRpcPlans.filter((plan) => plan.queryFamily !== "payrollMutationReceipts"), postRpcPlans.find((plan) => plan.queryFamily === "payrollMutationReceipts")];
    assert(sourcePlans.length === 4, `bucket_${bucket.rowCount}_source_plan_incomplete`);

    const expectedOutcome = bucket.expectedBlocker ?? "success";
    assert(
      rpcOutcome === expectedOutcome,
      `unexpected_rpc_outcome:${bucket.rowCount}:${rpcOutcome}:${expectedOutcome}`,
    );

    const bucketResult = {
      bucketRowCount: bucket.rowCount,
      expectedBlocker: bucket.expectedBlocker,
      rpcOutcome,
      rpcWallMs,
      rowCounts: {
        beforeRpc: preRpcCounts,
        afterRpc: postRpcCounts,
      },
      sourcePlans,
      indexUse: Object.fromEntries(
        sourcePlans.map((plan) => [plan.queryFamily, plan.planSummary.indexNames]),
      ),
      fixtureScope: {
        organizationId: fixture.organizationId,
        employmentId: fixture.employmentId,
        payPeriodId: fixture.payPeriodId,
        policyVersionId: fixture.policyVersionId,
      },
      rpcResultSummary: {
        state: "ok",
        sourceHash: result.sourceHash,
        snapshotId: result.snapshotId,
        replayed: result.replayed,
      },
    };

    assertRequiredPlanIndexes(bucketResult);
    return bucketResult;
  } finally {
    await database.query("ROLLBACK").catch(() => undefined);
  }
};

const writeArtifact = async (artifact) => {
  await mkdir(REPORTS_DIR, { recursive: true });
  const artifactPath = path.join(
    REPORTS_DIR,
    `payroll-timesheet-derive-contract-1f-${timestampSlug()}.json`,
  );
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
};

const main = async () => {
  const databaseUrl = requiredEnv("PAYROLL_LOCAL_DATABASE_URL");
  assertLocalPayrollDatabase(databaseUrl);

  const database = new Client({ connectionString: databaseUrl });
  const readFailure = attachDatabaseErrorGuard(database);
  let connected = false;
  try {
    await database.connect();
    connected = true;

    const bucketResults = [];
    for (const [bucketIndex, bucket] of BUCKETS.entries()) {
      bucketResults.push(await buildBucketResult(database, bucketIndex + 1, bucket));
    }

    assert(!readFailure(), "database_client_failed");
    assert(
      JSON.stringify(bucketResults.map((bucket) => bucket.bucketRowCount)) === JSON.stringify([0, 50, 200, 500]),
      "required_bucket_missing",
    );

    const artifact = {
      success: true,
      generatedAt: new Date().toISOString(),
      artifactVersion: "task-3-fix-round-1f",
      databaseTarget: {
        host: "127.0.0.1",
        port: 54322,
        database: "postgres",
      },
      buckets: bucketResults.map((bucket) => ({
        bucketRowCount: bucket.bucketRowCount,
        expectedBlocker: bucket.expectedBlocker,
        rpcOutcome: bucket.rpcOutcome,
        rpcWallMs: bucket.rpcWallMs,
        rowCounts: bucket.rowCounts,
        sourcePlans: bucket.sourcePlans,
        indexUse: bucket.indexUse,
        fixtureScope: bucket.fixtureScope,
        rpcResultSummary: bucket.rpcResultSummary,
      })),
    };
    const artifactPath = await writeArtifact(artifact);

    console.log(JSON.stringify({
      success: true,
      artifactPath,
      bucketCount: artifact.buckets.length,
      buckets: artifact.buckets.map((bucket) => ({
        bucketRowCount: bucket.bucketRowCount,
        rpcOutcome: bucket.rpcOutcome,
        rpcWallMs: bucket.rpcWallMs,
      })),
    }));
  } finally {
    if (connected) {
      await database.end().catch(() => undefined);
    }
  }
};

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    reasonCode: error instanceof Error ? error.message : "database_contract_failed",
  }));
  process.exit(1);
});
