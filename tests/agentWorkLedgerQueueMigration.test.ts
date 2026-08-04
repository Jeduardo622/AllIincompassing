import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const coreMigrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260801090000_agent_work_ledger_core.sql',
);

const queueMigrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260801093000_agent_work_ledger_queue.sql',
);

const coreSql = readFileSync(coreMigrationPath, 'utf8');
const queueMigrationExists = existsSync(queueMigrationPath);
const queueSql = queueMigrationExists ? readFileSync(queueMigrationPath, 'utf8') : '';
const normalizedQueueSql = queueSql.replace(/\s+/g, ' ');
const enqueueTriggerSql = queueSql.match(
  /create or replace function public\.agent_work_enqueue_ready_step_trigger\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const queueReadSql = queueSql.match(
  /create or replace function public\.read_agent_work_messages\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const runtimePolicySql = queueSql.match(
  /create or replace function public\.load_agent_work_runtime_policy\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const claimSql = queueSql.match(
  /create or replace function public\.claim_queued_agent_work_step\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const runnerScopeSql = queueSql.match(
  /create or replace function public\.read_agent_work_runner_scope\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const poisonSweepSql = queueSql.match(
  /create or replace function public\.archive_agent_work_poison_messages\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const advisoryProjectionLockSql = queueSql.match(
  /create or replace function public\.agent_work_lock_advisory_projection_context\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const advisoryProjectionRecordSql = queueSql.match(
  /create or replace function public\.record_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const advisoryProjectionReadSql = queueSql.match(
  /create or replace function public\.read_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';
const advisoryProjectionFinalizeSql = queueSql.match(
  /create or replace function public\.finalize_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';

describe('agent work ledger queue migration contract', () => {
  it('adds the planned Task 9 queue migration file', () => {
    expect(queueMigrationExists).toBe(true);
  });

  it('creates a private durable pgmq queue without exposing pgmq_public', () => {
    expect(normalizedQueueSql).toMatch(/pgmq\.create\(\s*'agent_work_[^']+'/i);
    expect(normalizedQueueSql).not.toMatch(/pgmq_public/i);
    expect(normalizedQueueSql).not.toMatch(/grant\s+.+\s+on\s+schema\s+pgmq/i);
  });

  it('validates the exact queue payload shape from the approved Task 9 contract', () => {
    expect(normalizedQueueSql).toMatch(
      /array\[\s*'workItemId'\s*,\s*'stepId'\s*,\s*'organizationId'\s*,\s*'availableAt'\s*,\s*'correlationId'\s*,\s*'workflowVersion'\s*\]/i,
    );
    expect(normalizedQueueSql).toMatch(/workItemId/i);
    expect(normalizedQueueSql).toMatch(/organizationId/i);
    expect(normalizedQueueSql).toMatch(/availableAt/i);
    expect(normalizedQueueSql).toMatch(/workflowVersion/i);
  });

  it('wraps pgmq access in fixed security-definer service-role-only enqueue, read, and archive functions', () => {
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.[^(]*enqueue[^(]*\([\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.[^(]*read[^(]*\([\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.[^(]*archive[^(]*\([\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.[^(]*enqueue[^(]*\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.[^(]*read[^(]*\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.[^(]*archive[^(]*\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.[^(]*enqueue[^(]*\([^)]*\) to service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.[^(]*read[^(]*\([^)]*\) to service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.[^(]*archive[^(]*\([^)]*\) to service_role/i,
    );
  });

  it('adds an empty-search-path advisory projection RPC lifecycle with service-role-only execution', () => {
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.agent_work_lock_advisory_projection_context\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.record_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.read_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.finalize_agent_work_advisory_projection_effect\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.agent_work_lock_advisory_projection_context\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.record_agent_work_advisory_projection_effect\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.read_agent_work_advisory_projection_effect\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.finalize_agent_work_advisory_projection_effect\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.record_agent_work_advisory_projection_effect\([^)]*\) to service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.read_agent_work_advisory_projection_effect\([^)]*\) to service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.finalize_agent_work_advisory_projection_effect\([^)]*\) to service_role/i,
    );
  });

  it('uses pgmq read visibility and archive semantics instead of direct queue table access', () => {
    expect(normalizedQueueSql).toMatch(/pgmq\.read\([^)]*(?:vt|visibility)[^)]*\)/i);
    expect(normalizedQueueSql).toMatch(/pgmq\.archive\(/i);
    expect(normalizedQueueSql).not.toMatch(/select\s+\*\s+from\s+pgmq\./i);
  });

  it('preserves future-due queue messages for another delivery attempt', () => {
    expect(queueReadSql).toMatch(
      /if\s+v_payload\.available_at\s*>\s*timezone\('utc',\s*now\(\)\)\s+then[\s\S]*pgmq\.set_vt\(/i,
    );
    expect(queueReadSql).not.toMatch(
      /v_payload\.available_at\s*>[\s\S]{0,200}pgmq\.archive/i,
    );
  });

  it('keeps runtime authority within disabled, shadow, and advisory modes', () => {
    expect(runtimePolicySql).toMatch(/'disabled'[\s\S]*'shadow'[\s\S]*'advisory'/i);
    expect(runtimePolicySql).not.toMatch(/'active'/i);
  });

  it('allows queue claims only for deterministic steps', () => {
    expect(claimSql).toMatch(/execution_mode\s*=\s*'deterministic'/i);
    expect(claimSql).not.toMatch(/execution_mode\s*=\s*'human'/i);
  });

  it('loads composite step and item records with valid PL/pgSQL assignments', () => {
    expect(normalizedQueueSql).not.toMatch(
      /select\s+s\.\*,\s*i\.\*\s+into\s+v_step,\s*v_item/i,
    );
  });

  it('does not terminate PL/pgSQL bodies with nested untagged dollar quotes', () => {
    expect(normalizedQueueSql).not.toMatch(/:=\s*\$\$[^$]+\$\$/i);
  });

  it('adds sweeper contracts for retry scheduling, stale lease recovery, waiting wakeup, approval expiry, and poison archival', () => {
    expect(normalizedQueueSql).toMatch(/retry_scheduled/i);
    expect(normalizedQueueSql).toMatch(/lease_expires_at\s*<=/i);
    expect(normalizedQueueSql).toMatch(/wake_at\s*<=/i);
    expect(normalizedQueueSql).toMatch(
      /update public\.agent_work_approvals[\s\S]*status\s*=\s*'expired'/i,
    );
    expect(normalizedQueueSql).toMatch(/poison/i);
    expect(normalizedQueueSql).toMatch(/archive/i);
  });

  it('records advisory projection effects with fixed kind/target and collision-safe idempotent upsert semantics', () => {
    expect(advisoryProjectionRecordSql).toMatch(/#variable_conflict\s+use_column/i);
    expect(advisoryProjectionRecordSql).toMatch(/'advisory_projection'/i);
    expect(advisoryProjectionRecordSql).toMatch(/'agent_work_step'/i);
    expect(advisoryProjectionRecordSql).toMatch(/on conflict\s*\(\s*organization_id\s*,\s*unique_effect_key\s*\)\s*do update/i);
    expect(advisoryProjectionRecordSql).toMatch(/status\s*=\s*'verified'/i);
    expect(advisoryProjectionRecordSql).toMatch(/public\.agent_work_effects\.payload_hash\s*=\s*excluded\.payload_hash/i);
  });

  it('qualifies attempt columns that collide with advisory lock output names', () => {
    expect(advisoryProjectionLockSql).toMatch(/from public\.agent_work_attempts attempt/i);
    expect(advisoryProjectionLockSql).toMatch(/attempt\.work_item_id\s*=\s*v_step\.work_item_id/i);
    expect(advisoryProjectionLockSql).not.toMatch(/\band work_item_id\s*=\s*v_step\.work_item_id/i);
  });

  it('qualifies step columns that collide with advisory read output names', () => {
    expect(advisoryProjectionReadSql).toMatch(/from public\.agent_work_steps step/i);
    expect(advisoryProjectionReadSql).toMatch(/where step\.id\s*=\s*v_effect\.step_id/i);
    expect(advisoryProjectionReadSql).not.toMatch(/\bwhere id\s*=\s*v_effect\.step_id/i);
  });

  it('finalizes advisory projection effects by verifying the effect row and atomically completing the running step through transition_agent_work_step', () => {
    expect(advisoryProjectionFinalizeSql).toMatch(/status\s*=\s*'verified'/i);
    expect(advisoryProjectionFinalizeSql).toMatch(/verified_at\s*=\s*coalesce\(verified_at/i);
    expect(advisoryProjectionFinalizeSql).toMatch(/transition_agent_work_step\(/i);
    expect(advisoryProjectionFinalizeSql).toMatch(/'advisory_projection_applied'/i);
    expect(advisoryProjectionFinalizeSql).toMatch(/agent_work_advisory_projection_descriptor/i);
  });

  it('derives projection hashes from authoritative assessment-domain rows without copying content into the ledger', () => {
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.agent_work_advisory_projection_descriptor\(/i,
    );
    expect(normalizedQueueSql).toMatch(/assessment_documents/i);
    expect(normalizedQueueSql).toMatch(/assessment_checklist_items/i);
    expect(normalizedQueueSql).toMatch(/assessment_structured_sections/i);
    expect(normalizedQueueSql).toMatch(/digest\(/i);
    expect(normalizedQueueSql).not.toMatch(/'projection:v%s:%s:%s'/i);
    expect(normalizedQueueSql).toMatch(
      /effect_key\s*:=\s*encode\(\s*extensions\.digest\(/i,
    );
    expect(normalizedQueueSql).toMatch(/workflow_key/i);
    expect(normalizedQueueSql).toMatch(/step_key/i);
    expect(normalizedQueueSql).toMatch(/owner_user_id/i);
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.agent_work_advisory_projection_descriptor\([^)]*\) from public, anon, authenticated, service_role/i,
    );
  });

  it('exposes a fixed service-role runner scope RPC containing only scope, state, and hashes', () => {
    expect(normalizedQueueSql).toMatch(
      /create or replace function public\.read_agent_work_runner_scope\(/i,
    );
    expect(normalizedQueueSql).toMatch(
      /grant execute on function public\.read_agent_work_runner_scope\([^)]*\) to service_role/i,
    );
    expect(normalizedQueueSql).toMatch(/array_agg\(evidence\.sha256/i);
    expect(runnerScopeSql).not.toMatch(/value_text|value_json|source_span/i);
  });

  it('inspects poison messages without consuming healthy queue traffic', () => {
    expect(poisonSweepSql).toMatch(/from pgmq\.q_agent_work_steps/i);
    expect(poisonSweepSql).not.toMatch(/pgmq\.read\(/i);
  });

  it('does not auto-enable scheduler, network, or Vault extensions and exposes no generic Vault relay', () => {
    expect(normalizedQueueSql).not.toMatch(
      /create extension if not exists (?:pg_cron|pg_net|vault)/i,
    );
    expect(normalizedQueueSql).not.toMatch(/p_vault_api_key_secret_name/i);
    expect(normalizedQueueSql).not.toMatch(
      /grant execute on function public\.enable_agent_work_queue_scheduler/i,
    );
    expect(normalizedQueueSql).not.toMatch(
      /grant execute on function public\.disable_agent_work_queue_scheduler/i,
    );
    expect(normalizedQueueSql).toMatch(/extname\s*=\s*'supabase_vault'/i);
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.enable_local_agent_work_queue_scheduler\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedQueueSql).toMatch(
      /revoke all on function public\.disable_local_agent_work_queue_scheduler\([^)]*\) from public, anon, authenticated, service_role/i,
    );
  });

  it('casts conditional step statuses to the database enum', () => {
    const conditionalStatuses = normalizedQueueSql.match(
      /status\s*=\s*\(?case\b[^;]*?end\)?::public\.agent_work_step_status/gi,
    );

    expect(conditionalStatuses).toHaveLength(3);
    expect(normalizedQueueSql).not.toMatch(
      /last_error_(?:class|code)\s*=\s*case[^,]+end::public\.agent_work_step_status/i,
    );
  });

  it('keeps the enqueue trigger inert for terminal parent work items', () => {
    expect(enqueueTriggerSql).toMatch(/from public\.agent_work_items/i);
    expect(enqueueTriggerSql).toMatch(
      /status\s+not\s+in\s*\(\s*'completed'\s*,\s*'failed'\s*,\s*'cancelled'\s*\)/i,
    );
  });

  it('keeps Cron and Vault out of the baseline core migration', () => {
    expect(coreSql).not.toMatch(/pg_cron|pg_net|cron\.schedule|vault\./i);
  });
});
