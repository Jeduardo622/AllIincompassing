import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { assertLocalPostgresUrl } from "./agent-work-ledger-harness/localRuntime.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const SCHEDULE = "0 0 1 1 *";
const FIXED_SECRET_NAMES = Object.freeze([
  "agent_work_hosted_project_ref",
  "agent_work_hosted_publishable_key",
  "agent_work_hosted_runner_secret",
  "agent_work_hosted_sweeper_secret",
]);
const FIXED_JOB_NAMES = Object.freeze([
  "agent-work-runner-hosted",
  "agent-work-sweeper-hosted",
]);

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const countRows = async (database, table, column, names) => {
  const { rows } = await database.query(
    `select count(*)::integer as count from ${table} where ${column} = any($1::text[])`,
    [names],
  );
  return rows[0]?.count ?? 0;
};

const assertNoResidue = async (database) => {
  const jobs = await countRows(database, "cron.job", "jobname", FIXED_JOB_NAMES);
  const secrets = await countRows(database, "vault.secrets", "name", FIXED_SECRET_NAMES);
  assert(jobs === 0, "Hosted scheduler contract left fixed Cron job residue.");
  assert(secrets === 0, "Hosted scheduler contract left fixed Vault secret residue.");
};

const main = async () => {
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLocalPostgresUrl(databaseUrl, "SUPABASE_DB_URL");

  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const { rows: identityRows } = await database.query("select current_user");
    assert(identityRows[0]?.current_user === "postgres", "Scheduler contract requires the local postgres owner.");

    const { rows: migrationRows } = await database.query(
      "select to_regprocedure('public.enable_hosted_agent_work_queue_scheduler(text,integer,integer)') is not null as installed",
    );
    assert(migrationRows[0]?.installed === true, "Hosted scheduler migration is not installed.");

    await database.query("create extension if not exists pg_cron");
    await database.query("create extension if not exists pg_net with schema extensions");
    await database.query("create extension if not exists supabase_vault with schema vault");
    await assertNoResidue(database);

    const syntheticSecrets = [
      "not-a-project",
      `sb_publishable_${randomBytes(24).toString("hex")}`,
      `local-runner-${randomBytes(24).toString("hex")}`,
      `local-sweeper-${randomBytes(24).toString("hex")}`,
    ];

    await database.query("begin");
    try {
      for (let index = 0; index < FIXED_SECRET_NAMES.length; index += 1) {
        await database.query(
          "select vault.create_secret($1::text, $2::text, 'Synthetic Agent Work hosted scheduler contract')",
          [syntheticSecrets[index], FIXED_SECRET_NAMES[index]],
        );
      }

      const { rows: initialStatusRows } = await database.query(
        "select public.hosted_agent_work_queue_scheduler_status() as status",
      );
      assert(initialStatusRows[0]?.status?.secretsReady === true, "Hosted scheduler status did not recognize fixed secrets.");
      assert(initialStatusRows[0]?.status?.runnerJob?.present === false, "Runner job must start absent.");
      assert(initialStatusRows[0]?.status?.sweeperJob?.present === false, "Sweeper job must start absent.");

      await database.query("savepoint invalid_project_ref");
      let invalidProjectRefDenied = false;
      try {
        await database.query(
          "select public.enable_hosted_agent_work_queue_scheduler($1::text, 5000, 25)",
          [SCHEDULE],
        );
      } catch (error) {
        invalidProjectRefDenied = String(error?.message ?? error).includes("project ref is invalid");
        await database.query("rollback to savepoint invalid_project_ref");
      }
      assert(invalidProjectRefDenied, "Hosted scheduler accepted an invalid project ref.");

      const { rows: projectRefSecretRows } = await database.query(
        "select id from vault.secrets where name = 'agent_work_hosted_project_ref'",
      );
      assert(projectRefSecretRows.length === 1, "Hosted project ref Vault entry is missing or duplicated.");
      await database.query(
        "select vault.update_secret($1::uuid, $2::text, $3::text, $4::text)",
        [
          projectRefSecretRows[0].id,
          PROJECT_REF,
          "agent_work_hosted_project_ref",
          "Synthetic Agent Work hosted scheduler contract",
        ],
      );

      for (let index = 0; index < FIXED_SECRET_NAMES.length; index += 1) {
        const secretName = FIXED_SECRET_NAMES[index];
        const { rows: secretRows } = await database.query(
          "select id from vault.secrets where name = $1::text",
          [secretName],
        );
        assert(secretRows.length === 1, `Hosted Vault entry is missing or duplicated: ${secretName}.`);
        for (const whitespaceValue of ["   ", "\t\n"]) {
          await database.query(
            "select vault.update_secret($1::uuid, $2::text, $3::text, $4::text)",
            [
              secretRows[0].id,
              whitespaceValue,
              secretName,
              "Synthetic Agent Work hosted scheduler contract",
            ],
          );

          const { rows: blankSecretStatusRows } = await database.query(
            "select public.hosted_agent_work_queue_scheduler_status() as status",
          );
          assert(blankSecretStatusRows[0]?.status?.secretsReady === false, `Whitespace-only hosted secret must not be ready: ${secretName}.`);

          await database.query("savepoint blank_secret_denial");
          let blankSecretDenied = false;
          try {
            await database.query(
              "select public.enable_hosted_agent_work_queue_scheduler($1::text, 5000, 25)",
              [SCHEDULE],
            );
          } catch (error) {
            blankSecretDenied = String(error?.message ?? error).includes("secrets are unavailable");
            await database.query("rollback to savepoint blank_secret_denial");
          }
          assert(blankSecretDenied, `Hosted scheduler accepted a whitespace-only secret: ${secretName}.`);
          await database.query("release savepoint blank_secret_denial");
        }

        await database.query(
          "select vault.update_secret($1::uuid, $2::text, $3::text, $4::text)",
          [
            secretRows[0].id,
            index === 0 ? PROJECT_REF : syntheticSecrets[index],
            secretName,
            "Synthetic Agent Work hosted scheduler contract",
          ],
        );
      }

      await database.query(
        "select public.enable_hosted_agent_work_queue_scheduler($1::text, 5000, 25)",
        [SCHEDULE],
      );

      const { rows: jobs } = await database.query(
        "select jobname, schedule, command, active from cron.job where jobname = any($1::text[]) order by jobname",
        [FIXED_JOB_NAMES],
      );
      assert(jobs.length === 2, "Hosted scheduler did not create exactly two fixed jobs.");
      assert(jobs.every((job) => job.schedule === SCHEDULE && job.active === true), "Hosted scheduler job metadata drifted.");
      const commands = jobs.map((job) => job.command).join("\n");
      assert(commands.includes(`https://${PROJECT_REF}.supabase.co/functions/v1/agent-work-runner`), "Runner URL is not project-bound.");
      assert(commands.includes(`https://${PROJECT_REF}.supabase.co/functions/v1/agent-work-sweeper`), "Sweeper URL is not project-bound.");
      assert(commands.includes("x-agent-work-runner-secret"), "Runner invocation header is missing.");
      assert(commands.includes("x-agent-work-sweeper-secret"), "Sweeper invocation header is missing.");
      assert(!commands.includes("Authorization"), "Hosted scheduler command contains an authorization bearer header.");
      assert(!commands.includes("agent_work_hosted_service_role_key"), "Hosted scheduler command references a service-role Vault key.");
      assert(!commands.includes("host.docker.internal"), "Hosted scheduler reused a local callback target.");
      for (const secret of syntheticSecrets.slice(1)) {
        assert(!commands.includes(secret), "Hosted scheduler command contains plaintext secret material.");
      }

      const { rows: statusRows } = await database.query(
        "select public.hosted_agent_work_queue_scheduler_status() as status",
      );
      const status = statusRows[0]?.status;
      assert(status?.runnerJob?.present === true && status?.sweeperJob?.present === true, "Hosted status omitted active jobs.");
      assert(!JSON.stringify(status).includes("command"), "Hosted status exposed Cron command text.");
      for (const secret of syntheticSecrets.slice(1)) {
        assert(!JSON.stringify(status).includes(secret), "Hosted status exposed secret material.");
      }

      await database.query("savepoint api_role_denial");
      let serviceRoleDenied = false;
      try {
        await database.query("set local role service_role");
        await database.query("select public.hosted_agent_work_queue_scheduler_status()");
      } catch (error) {
        serviceRoleDenied = error?.code === "42501";
        await database.query("rollback to savepoint api_role_denial");
      }
      assert(serviceRoleDenied, "Service role can execute an operator-only scheduler controller.");

      const { rows: disableRows } = await database.query(
        "select public.disable_hosted_agent_work_queue_scheduler() as result",
      );
      assert(disableRows[0]?.result?.removedCount === 2, "Hosted scheduler disable did not remove both jobs.");
      assert(await countRows(database, "cron.job", "jobname", FIXED_JOB_NAMES) === 0, "Hosted jobs remain after disable.");

      await database.query("rollback");
    } catch (error) {
      await database.query("rollback");
      throw error;
    }

    await assertNoResidue(database);
    console.log(JSON.stringify({
      success: true,
      projectBinding: "synthetic",
      checkedJobs: FIXED_JOB_NAMES.length,
      checkedSecrets: FIXED_SECRET_NAMES.length,
      residue: { jobs: 0, secrets: 0 },
    }));
  } finally {
    await database.end();
  }
};

await main();
