-- @migration-intent: add operator-only hosted scheduler controls for deterministic Agent Work recovery
-- @migration-dependencies: 20260801093000_agent_work_ledger_queue.sql
-- @migration-rollback: disable the two fixed hosted jobs, remove the four fixed hosted Vault entries, then drop these three controller functions

begin;

create or replace function public.hosted_agent_work_queue_scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pg_cron_enabled boolean;
  v_pg_net_enabled boolean;
  v_vault_enabled boolean;
  v_secrets_ready boolean := false;
  v_runner_job jsonb := jsonb_build_object('present', false, 'active', false, 'schedule', null);
  v_sweeper_job jsonb := jsonb_build_object('present', false, 'active', false, 'schedule', null);
begin
  select exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) into v_pg_cron_enabled;
  select exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_net'
  ) into v_pg_net_enabled;
  select exists (
    select 1 from pg_catalog.pg_extension where extname = 'supabase_vault'
  ) into v_vault_enabled;

  if v_vault_enabled then
    select count(*) = 4 and count(distinct name) = 4
    into v_secrets_ready
    from vault.decrypted_secrets
    where name in (
      'agent_work_hosted_project_ref',
      'agent_work_hosted_publishable_key',
      'agent_work_hosted_runner_secret',
      'agent_work_hosted_sweeper_secret'
    ) and decrypted_secret is not null
      and decrypted_secret !~ '^[[:space:]]*$';
  end if;

  if v_pg_cron_enabled then
    select jsonb_build_object(
      'present', count(*) > 0,
      'active', coalesce(bool_or(job.active), false),
      'schedule', case when count(distinct job.schedule) = 1 then min(job.schedule) else null end,
      'jobCount', count(*)
    )
    into v_runner_job
    from cron.job as job
    where job.jobname = 'agent-work-runner-hosted';

    select jsonb_build_object(
      'present', count(*) > 0,
      'active', coalesce(bool_or(job.active), false),
      'schedule', case when count(distinct job.schedule) = 1 then min(job.schedule) else null end,
      'jobCount', count(*)
    )
    into v_sweeper_job
    from cron.job as job
    where job.jobname = 'agent-work-sweeper-hosted';
  end if;

  return jsonb_build_object(
    'extensions', jsonb_build_object(
      'pgCron', v_pg_cron_enabled,
      'pgNet', v_pg_net_enabled,
      'vault', v_vault_enabled
    ),
    'secretsReady', v_secrets_ready,
    'runnerJob', coalesce(v_runner_job, jsonb_build_object('present', false, 'active', false, 'schedule', null)),
    'sweeperJob', coalesce(v_sweeper_job, jsonb_build_object('present', false, 'active', false, 'schedule', null))
  );
end;
$function$;

create or replace function public.disable_hosted_agent_work_queue_scheduler()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing_job_id bigint;
  v_removed_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(27104214731);

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    return jsonb_build_object('pgCronEnabled', false, 'removedCount', 0);
  end if;

  for v_existing_job_id in
    select jobid
    from cron.job
    where jobname in ('agent-work-runner-hosted', 'agent-work-sweeper-hosted')
  loop
    perform cron.unschedule(v_existing_job_id);
    v_removed_count := v_removed_count + 1;
  end loop;

  return jsonb_build_object('pgCronEnabled', true, 'removedCount', v_removed_count);
end;
$function$;

create or replace function public.enable_hosted_agent_work_queue_scheduler(
  p_schedule text,
  p_timeout_milliseconds integer default 5000,
  p_max_items_per_pass integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_ref text;
  v_runner_url text;
  v_sweeper_url text;
  v_runner_sql text;
  v_sweeper_sql text;
  v_runner_job_id bigint;
  v_sweeper_job_id bigint;
  v_existing_job_id bigint;
begin
  if p_schedule is null
    or btrim(p_schedule) = ''
    or p_schedule !~ '^[0-9*/,\- ]+$'
    or cardinality(regexp_split_to_array(btrim(p_schedule), E'\\s+')) <> 5 then
    raise exception 'Hosted scheduler cron expression is invalid';
  end if;

  if p_timeout_milliseconds is null
    or p_timeout_milliseconds < 1
    or p_timeout_milliseconds > 30000 then
    raise exception 'Hosted scheduler timeout is invalid';
  end if;

  if p_max_items_per_pass is null
    or p_max_items_per_pass < 1
    or p_max_items_per_pass > 100 then
    raise exception 'Hosted scheduler sweep bound is invalid';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise exception 'pg_cron extension is not enabled';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_net'
  ) then
    raise exception 'pg_net extension is not enabled';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'supabase_vault'
  ) then
    raise exception 'vault extension is not enabled';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(27104214731);

  if not (
    select count(*) = 4 and count(distinct name) = 4
    from vault.decrypted_secrets
    where name in (
      'agent_work_hosted_project_ref',
      'agent_work_hosted_publishable_key',
      'agent_work_hosted_runner_secret',
      'agent_work_hosted_sweeper_secret'
    ) and decrypted_secret is not null
      and decrypted_secret !~ '^[[:space:]]*$'
  ) then
    raise exception 'Fixed hosted scheduler secrets are unavailable';
  end if;

  select decrypted_secret
  into v_project_ref
  from vault.decrypted_secrets
  where name = 'agent_work_hosted_project_ref';

  if v_project_ref is null or v_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'Hosted scheduler project ref is invalid';
  end if;

  v_runner_url := format(
    'https://%s.supabase.co/functions/v1/agent-work-runner',
    v_project_ref
  );
  v_sweeper_url := format(
    'https://%s.supabase.co/functions/v1/agent-work-sweeper',
    v_project_ref
  );

  v_runner_sql := format(
    $runner$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_hosted_publishable_key'),
        'x-agent-work-runner-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_hosted_runner_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron', 'job_name', 'agent-work-runner-hosted'),
      timeout_milliseconds := %s
    ) as request_id
    $runner$,
    v_runner_url,
    p_timeout_milliseconds
  );

  v_sweeper_sql := format(
    $sweeper$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_hosted_publishable_key'),
        'x-agent-work-sweeper-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_hosted_sweeper_secret')
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'job_name', 'agent-work-sweeper-hosted',
        'maxItemsPerPass', %s
      ),
      timeout_milliseconds := %s
    ) as request_id
    $sweeper$,
    v_sweeper_url,
    p_max_items_per_pass,
    p_timeout_milliseconds
  );

  for v_existing_job_id in
    select jobid
    from cron.job
    where jobname in ('agent-work-runner-hosted', 'agent-work-sweeper-hosted')
  loop
    perform cron.unschedule(v_existing_job_id);
  end loop;

  select cron.schedule(
    'agent-work-runner-hosted',
    btrim(p_schedule),
    v_runner_sql
  ) into v_runner_job_id;
  select cron.schedule(
    'agent-work-sweeper-hosted',
    btrim(p_schedule),
    v_sweeper_sql
  ) into v_sweeper_job_id;

  return jsonb_build_object(
    'runnerJobId', v_runner_job_id,
    'sweeperJobId', v_sweeper_job_id,
    'schedule', btrim(p_schedule),
    'timeoutMilliseconds', p_timeout_milliseconds,
    'maxItemsPerPass', p_max_items_per_pass
  );
end;
$function$;

revoke all on function public.enable_hosted_agent_work_queue_scheduler(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.disable_hosted_agent_work_queue_scheduler() from public, anon, authenticated, service_role;
revoke all on function public.hosted_agent_work_queue_scheduler_status() from public, anon, authenticated, service_role;

commit;
