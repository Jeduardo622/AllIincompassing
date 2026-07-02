import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260701150000_employee_role_capability_matrix.sql',
);
const SMOKE_SQL_PATH = path.join(process.cwd(), 'tests', 'sql', 'employee_role_capability_smoke.sql');

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const smokeSql = readFileSync(SMOKE_SQL_PATH, 'utf8');

const extractFunction = (name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const match = sql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('employee role capability matrix migration', () => {
  it('keeps bt and midtier out of broad therapist/org_member helper aliases', () => {
    expect(sql).toContain("(normalized_role = 'therapist' AND r.name IN ('therapist', 'org_member'))");
    expect(sql).toContain("WHEN 'org_member' THEN ARRAY['therapist', 'client']::text[]");
    expect(sql).toContain("WHEN 'therapist' THEN ARRAY['therapist']::text[]");
    expect(sql).not.toContain(
      "normalized_role = 'therapist' AND r.name IN ('therapist', 'org_member', 'midtier', 'bt')",
    );
    expect(sql).not.toContain("WHEN 'therapist' THEN ARRAY['therapist', 'midtier', 'bt']::text[]");
  });

  it('treats bcba as super-admin-equivalent in database helper paths', () => {
    const currentUserSuperAdmin = extractFunction('app.current_user_is_super_admin');
    const isSuperAdmin = extractFunction('app.is_super_admin');

    expect(currentUserSuperAdmin).toContain("r.name IN ('super_admin', 'bcba')");
    expect(isSuperAdmin).toContain("r.name IN ('super_admin', 'bcba')");
  });

  it('allows admin_schedule to manage staff, clients, assignments, and authorizations only through explicit helpers', () => {
    const staffClientHelper = extractFunction('app.current_user_can_manage_staff_clients');
    const authorizationHelper = extractFunction('app.current_user_can_manage_authorizations');
    const programsGoalsHelper = extractFunction('app.current_user_can_manage_programs_goals');

    expect(staffClientHelper).toContain("ARRAY['admin', 'admin_schedule']::text[]");
    expect(authorizationHelper).toContain("ARRAY['admin', 'admin_schedule', 'midtier']::text[]");
    expect(programsGoalsHelper).toContain("ARRAY['admin', 'midtier', 'therapist']::text[]");
    expect(programsGoalsHelper).not.toContain('admin_schedule');

    expect(sql).toContain('CREATE POLICY org_write_clients');
    expect(sql).toContain('CREATE POLICY therapists_org_staff_manage');
    expect(sql).toContain('CREATE POLICY client_therapist_links_manage_scope');
    expect(sql).toContain('CREATE POLICY authorizations_org_write');
    expect(sql).toContain('app.current_user_can_manage_staff_clients(organization_id)');
    expect(sql).toContain('app.current_user_can_manage_authorizations(organization_id)');
  });

  it('limits bt programs, goals, sessions, and data-taking paths to assigned clients', () => {
    const readProgramsHelper = extractFunction('app.current_user_can_read_client_programs');
    const takeDataHelper = extractFunction('app.current_user_can_take_client_data');

    expect(readProgramsHelper).toContain("ARRAY['bt']::text[]");
    expect(readProgramsHelper).toContain(
      'app.current_user_has_assigned_client(target_organization_id, target_client_id)',
    );
    expect(takeDataHelper).toContain("ARRAY['therapist', 'bt']::text[]");
    expect(takeDataHelper).toContain(
      'app.current_user_has_assigned_client(target_organization_id, target_client_id)',
    );

    expect(sql).toContain('CREATE POLICY programs_org_read');
    expect(sql).toContain('CREATE POLICY goals_org_read');
    expect(sql).toContain('CREATE POLICY org_read_sessions');
    expect(sql).toContain('CREATE POLICY goal_data_points_org_manage');
    expect(sql).toContain('CREATE POLICY org_write_client_session_notes');
    expect(sql).toContain('app.current_user_can_read_client_programs(organization_id, client_id)');
    expect(sql).toContain('app.current_user_can_take_client_data(organization_id, client_id)');
    expect(sql).toContain('app.current_user_has_assigned_client(organization_id, id)');
  });

  it('keeps rewritten policies idempotent for repeated or partial local applies', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS therapists_org_staff_select ON public.therapists;');
    expect(sql).toContain('DROP POLICY IF EXISTS therapists_org_staff_manage ON public.therapists;');
    expect(sql).toContain('DROP POLICY IF EXISTS programs_org_read ON public.programs;');
    expect(sql).toContain('DROP POLICY IF EXISTS goals_org_read ON public.goals;');
  });

  it('keeps the hosted employee-role smoke cleanup-bound and matrix-aligned', () => {
    expect(smokeSql).toContain('set role authenticated');
    expect(smokeSql).toContain('cleanup_no_synthetic_rows_remaining');
    expect(smokeSql).toContain("remaining_rows=' || count(*)");
    expect(smokeSql).toContain('admin_schedule_authorization_write_allowed');
    expect(smokeSql).toContain('admin_schedule_assignment_write_allowed');
    expect(smokeSql).toContain('midtier_schedule_write_allowed');
    expect(smokeSql).toContain('bt_schedule_write_denied');
    expect(smokeSql).toContain('bcba_super_admin_equivalence_helpers');
  });
});
