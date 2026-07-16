import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260716162434_lock_bt_start_to_scheduled_plan.sql',
);

const sql = readFileSync(migrationPath, 'utf8');

const extractFunction = (): string => {
  const match = sql.match(
    /create or replace function public\.start_session_with_goals\([\s\S]*?\n\$\$;/i,
  );
  expect(match, 'start_session_with_goals should be replaced').not.toBeNull();
  return match?.[0] ?? '';
};

describe('BT session-start plan lock migration', () => {
  it('separates exact BT actors from super-admin and higher-capability role holders', () => {
    const functionSql = extractFunction();

    expect(functionSql).toContain('v_is_restricted_bt_actor boolean := false');
    expect(functionSql).toMatch(/not v_is_super_admin[\s\S]*array\['bt'\]::text\[\]/i);
    expect(functionSql).toMatch(
      /not coalesce\(app\.current_user_has_exact_role_for_org\([\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i,
    );
  });

  it('locks the session plan and rejects client-supplied BT linkage drift', () => {
    const functionSql = extractFunction();

    expect(functionSql).toMatch(/select[\s\S]*s\.program_id[\s\S]*s\.goal_id[\s\S]*for update/i);
    expect(functionSql).toMatch(/p_program_id is distinct from v_session\.program_id/i);
    expect(functionSql).toMatch(/p_goal_id is distinct from v_session\.goal_id/i);
    expect(functionSql).toMatch(/v_submitted_goal_ids is distinct from v_stored_goal_ids/i);
    expect(functionSql).toMatch(/array\(select distinct x from unnest\(v_submitted_goal_ids\) as x[\s\S]*order by x\)/i);
    expect(functionSql).toMatch(/select array_agg\(sg\.goal_id order by sg\.goal_id\)[\s\S]*from public\.session_goals sg[\s\S]*sg\.session_id = v_session\.id/i);
    expect(functionSql).toMatch(/array_length\(v_stored_goal_ids, 1\) is null/i);
    expect(functionSql).toMatch(/not \(v_session\.goal_id = any\(v_stored_goal_ids\)\)/i);
    expect(functionSql).toContain("'error_code', 'PLAN_MISMATCH'");
  });

  it('requires the stored primary and every linked goal plan to remain active and tenant-consistent', () => {
    const functionSql = extractFunction();

    expect(functionSql).toMatch(/from public\.programs p[\s\S]*p\.id = v_session\.program_id[\s\S]*p\.client_id = v_session\.client_id[\s\S]*p\.organization_id = v_session\.organization_id[\s\S]*p\.status = 'active'/i);
    expect(functionSql).toMatch(/from public\.goals g[\s\S]*g\.id = v_session\.goal_id[\s\S]*g\.program_id = v_session\.program_id[\s\S]*g\.client_id = v_session\.client_id[\s\S]*g\.organization_id = v_session\.organization_id[\s\S]*g\.status = 'active'/i);
    expect(functionSql).toMatch(/from public\.session_goals sg[\s\S]*join public\.goals g[\s\S]*join public\.programs p[\s\S]*sg\.session_id = v_session\.id[\s\S]*sg\.client_id = v_session\.client_id[\s\S]*sg\.organization_id = v_session\.organization_id[\s\S]*sg\.program_id = v_session\.program_id[\s\S]*g\.program_id = sg\.program_id[\s\S]*g\.status = 'active'[\s\S]*p\.status = 'active'/i);
    expect(functionSql).toContain("'error_code', 'INVALID_STORED_PLAN'");
  });

  it('starts restricted BT sessions without mutating their stored plan', () => {
    const functionSql = extractFunction();
    const restrictedBranch = functionSql.match(
      /if v_is_restricted_bt_actor then[\s\S]*?else[\s\S]*?end if;/i,
    )?.[0] ?? '';

    expect(restrictedBranch).toMatch(/update public\.sessions[\s\S]*started_at = v_started_at[\s\S]*status = 'in_progress'/i);
    expect(restrictedBranch).not.toMatch(/program_id\s*=/i);
    expect(restrictedBranch).not.toMatch(/goal_id\s*=/i);
    expect(restrictedBranch).not.toContain('insert into public.session_goals');

    expect(functionSql).toMatch(/else[\s\S]*program_id = p_program_id[\s\S]*goal_id = p_goal_id/i);
    expect(functionSql).toContain('insert into public.session_goals');
  });

  it('preserves the protected execute-grant and schema reload contract', () => {
    expect(extractFunction()).toMatch(/set search_path = ''/i);
    expect(sql).toContain(
      'revoke execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) from public;',
    );
    expect(sql).toContain(
      'revoke execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) from anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) to authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) to service_role;',
    );
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });
});
