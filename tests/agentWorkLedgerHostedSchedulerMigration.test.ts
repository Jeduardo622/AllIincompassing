import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.join(process.cwd(), 'supabase', 'migrations');
const migrationName = readdirSync(migrationsDirectory).find((name) =>
  name.endsWith('_agent_work_ledger_hosted_scheduler.sql')
);
const migrationPath = migrationName ? path.join(migrationsDirectory, migrationName) : '';
const migrationExists = migrationPath.length > 0 && existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, 'utf8') : '';
const normalizedSql = sql.replace(/\s+/g, ' ');

const functionBody = (name: string): string =>
  sql.match(
    new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'),
  )?.[1] ?? '';

describe('agent work hosted scheduler migration contract', () => {
  it('adds one forward hosted scheduler migration', () => {
    expect(migrationExists).toBe(true);
  });

  it('adds empty-search-path enable, disable, and sanitized status controllers', () => {
    for (const name of [
      'enable_hosted_agent_work_queue_scheduler',
      'disable_hosted_agent_work_queue_scheduler',
      'hosted_agent_work_queue_scheduler_status',
    ]) {
      expect(normalizedSql).toMatch(
        new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`, 'i'),
      );
    }
  });

  it('loads a fixed deployment-owned project ref and validates bounded scheduler inputs', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    expect(normalizedSql).toContain('agent_work_hosted_project_ref');
    expect(enableSql).toMatch(/select decrypted_secret[\s\S]*where name = 'agent_work_hosted_project_ref'/i);
    expect(enableSql).not.toMatch(/p_project_ref/i);
    expect(enableSql).toMatch(/\^\[a-z0-9\]\{20\}\$/i);
    expect(enableSql).toMatch(/p_timeout_milliseconds\s*<\s*1/i);
    expect(enableSql).toMatch(/p_timeout_milliseconds\s*>\s*30000/i);
    expect(enableSql).toMatch(/p_max_items_per_pass\s*<\s*1/i);
    expect(enableSql).toMatch(/p_max_items_per_pass\s*>\s*100/i);
    expect(enableSql).toMatch(/regexp_split_to_array/i);
    expect(enableSql).toMatch(/cardinality\([\s\S]{0,120}\)\s*<>\s*5/i);
  });

  it('fails closed unless pg_cron, pg_net, and Vault are enabled', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    expect(enableSql).toMatch(/extname\s*=\s*'pg_cron'/i);
    expect(enableSql).toMatch(/extname\s*=\s*'pg_net'/i);
    expect(enableSql).toMatch(/extname\s*=\s*'supabase_vault'/i);
    expect(enableSql).not.toMatch(/create extension/i);
  });

  it('uses only fixed hosted Vault and Cron names', () => {
    expect(normalizedSql).toContain('agent_work_hosted_project_ref');
    expect(normalizedSql).toContain('agent_work_hosted_service_role_key');
    expect(normalizedSql).toContain('agent_work_hosted_runner_secret');
    expect(normalizedSql).toContain('agent_work_hosted_sweeper_secret');
    expect(normalizedSql).toContain('agent-work-runner-hosted');
    expect(normalizedSql).toContain('agent-work-sweeper-hosted');
    expect(normalizedSql).not.toContain('agent_work_local_service_role_key');
    expect(normalizedSql).not.toContain('agent-work-runner-local');
  });

  it('derives exact hosted function URLs and sends the shipped secret headers', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    expect(enableSql).toMatch(/https:\/\/%s\.supabase\.co\/functions\/v1\/agent-work-runner/i);
    expect(enableSql).toMatch(/https:\/\/%s\.supabase\.co\/functions\/v1\/agent-work-sweeper/i);
    expect(enableSql).toContain('x-agent-work-runner-secret');
    expect(enableSql).toContain('x-agent-work-sweeper-secret');
    expect(enableSql).toContain('Authorization');
    expect(enableSql).toContain('Bearer ');
  });

  it('keeps secrets indirect in stored Cron commands and reports readiness without values', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    expect(enableSql).toMatch(/vault\.decrypted_secrets/i);
    expect(enableSql).toMatch(/where name = 'agent_work_hosted_service_role_key'/i);
    expect(enableSql).not.toMatch(/p_service_role|p_runner_secret|p_sweeper_secret/i);
    const statusSql = functionBody('hosted_agent_work_queue_scheduler_status');
    expect(statusSql).toMatch(/vault\.decrypted_secrets/i);
    expect(statusSql).not.toMatch(/jsonb_build_object\([^;]*decrypted_secret/i);
    expect(statusSql).toMatch(/count\(distinct name\)\s*=\s*4/i);
    expect(enableSql).toMatch(/count\(distinct name\)\s*=\s*4/i);
    expect(statusSql).toContain("decrypted_secret !~ '^[[:space:]]*$'");
    expect(enableSql).toContain("decrypted_secret !~ '^[[:space:]]*$'");
  });

  it('serializes enable and disable operations and tolerates pre-existing duplicate rows in status', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    const disableSql = functionBody('disable_hosted_agent_work_queue_scheduler');
    const statusSql = functionBody('hosted_agent_work_queue_scheduler_status');
    expect(enableSql).toMatch(/pg_advisory_xact_lock/i);
    expect(disableSql).toMatch(/pg_advisory_xact_lock/i);
    expect(statusSql).toMatch(/count\(\*\)/i);
    expect(statusSql).toMatch(/bool_or\(/i);
  });

  it('replaces and removes exactly the two fixed jobs through cron APIs', () => {
    const enableSql = functionBody('enable_hosted_agent_work_queue_scheduler');
    const disableSql = functionBody('disable_hosted_agent_work_queue_scheduler');
    expect(enableSql).toMatch(/cron\.schedule\(/i);
    expect(enableSql).toMatch(/cron\.unschedule\(/i);
    expect(disableSql).toMatch(/cron\.unschedule\(/i);
    expect(normalizedSql).not.toMatch(/(?:insert|update|delete)\s+(?:from\s+)?cron\.job/i);
  });

  it('reports only sanitized readiness and job metadata', () => {
    const statusSql = functionBody('hosted_agent_work_queue_scheduler_status');
    expect(statusSql).toMatch(/secretsReady/i);
    expect(statusSql).toMatch(/runnerJob/i);
    expect(statusSql).toMatch(/sweeperJob/i);
    expect(statusSql).not.toMatch(/jsonb_build_object\([^;]*decrypted_secret/i);
    expect(statusSql).not.toMatch(/command/i);
  });

  it('keeps all scheduler controllers unavailable to API roles', () => {
    for (const signature of [
      'enable_hosted_agent_work_queue_scheduler(text, integer, integer)',
      'disable_hosted_agent_work_queue_scheduler()',
      'hosted_agent_work_queue_scheduler_status()',
    ]) {
      expect(normalizedSql).toMatch(
        new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')} from public, anon, authenticated, service_role`, 'i'),
      );
    }
    expect(normalizedSql).not.toMatch(/grant execute on function public\.(?:enable|disable|hosted)_hosted_agent_work/i);
  });
});
