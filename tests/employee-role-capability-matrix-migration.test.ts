import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260701150000_employee_role_capability_matrix.sql',
);
const EXPOSE_PROGRAM_GOAL_RPC_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260702194500_expose_program_goal_capability_rpc.sql',
);
const EMPLOYEE_ROLE_LISTING_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260702120000_super_admin_employee_role_listing.sql',
);
const EMPLOYEE_ROLE_LISTING_GRANTS_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260702222500_restrict_employee_users_paged_execute_grants.sql',
);
const BCBA_EXACT_CAPABILITY_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260706023600_bcba_exact_capability_matrix.sql',
);
const SUPER_ADMIN_PRECEDENCE_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260707121500_super_admin_bcba_role_precedence.sql',
);
const START_SESSION_AUTHZ_MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260707194500_start_session_employee_role_authz.sql',
);
const SMOKE_SQL_PATH = path.join(process.cwd(), 'tests', 'sql', 'employee_role_capability_smoke.sql');

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const exposeProgramGoalRpcSql = readFileSync(EXPOSE_PROGRAM_GOAL_RPC_MIGRATION_PATH, 'utf8');
const employeeRoleListingSql = readFileSync(EMPLOYEE_ROLE_LISTING_MIGRATION_PATH, 'utf8');
const employeeRoleListingGrantsSql = readFileSync(EMPLOYEE_ROLE_LISTING_GRANTS_MIGRATION_PATH, 'utf8');
const bcbaExactCapabilitySql = readFileSync(BCBA_EXACT_CAPABILITY_MIGRATION_PATH, 'utf8');
const superAdminPrecedenceSql = readFileSync(SUPER_ADMIN_PRECEDENCE_MIGRATION_PATH, 'utf8');
const startSessionAuthzSql = readFileSync(START_SESSION_AUTHZ_MIGRATION_PATH, 'utf8');
const smokeSql = readFileSync(SMOKE_SQL_PATH, 'utf8');

const extractFunctionFrom = (sourceSql: string, name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const match = sourceSql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? '';
};

const extractFunction = (name: string): string => extractFunctionFrom(sql, name);
const extractBcbaExactFunction = (name: string): string => extractFunctionFrom(bcbaExactCapabilitySql, name);
const extractSuperAdminPrecedenceFunction = (name: string): string =>
  extractFunctionFrom(superAdminPrecedenceSql, name);
const extractStartSessionAuthzFunction = (name: string): string => extractFunctionFrom(startSessionAuthzSql, name);

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

  it('removes BCBA from super-admin helper paths in the exact-capability follow-up', () => {
    const currentUserSuperAdmin = extractBcbaExactFunction('app.current_user_is_super_admin');
    const isSuperAdmin = extractBcbaExactFunction('app.is_super_admin');
    const roleForOrg = extractBcbaExactFunction('app.user_has_role_for_org');

    expect(currentUserSuperAdmin).toContain("r.name = 'super_admin'");
    expect(isSuperAdmin).toContain("r.name = 'super_admin'");
    expect(currentUserSuperAdmin).not.toContain("'bcba'");
    expect(isSuperAdmin).not.toContain("'bcba'");
    expect(roleForOrg).toContain("r.name IN ('super_admin', 'org_super_admin')");
    expect(roleForOrg).not.toContain("r.name IN ('super_admin', 'org_super_admin', 'bcba')");
  });

  it('keeps BCBA operational access explicit in the exact-capability follow-up', () => {
    expect(extractBcbaExactFunction('app.current_user_can_manage_staff_clients')).toContain(
      "ARRAY['admin', 'admin_schedule', 'bcba']::text[]",
    );
    expect(extractBcbaExactFunction('app.current_user_can_manage_authorizations')).toContain(
      "ARRAY['admin', 'admin_schedule', 'midtier', 'bcba']::text[]",
    );
    expect(extractBcbaExactFunction('app.current_user_can_manage_schedule')).toContain(
      "ARRAY['admin', 'admin_schedule', 'midtier', 'therapist', 'bcba']::text[]",
    );
    expect(extractBcbaExactFunction('app.current_user_can_manage_programs_goals')).toContain(
      "ARRAY['admin', 'midtier', 'therapist', 'bcba']::text[]",
    );
    expect(extractBcbaExactFunction('app.current_user_can_take_client_data')).toContain(
      "ARRAY['admin', 'midtier', 'bcba']::text[]",
    );
    expect(bcbaExactCapabilitySql).toContain(
      "ARRAY['admin', 'admin_schedule', 'therapist', 'midtier', 'bcba']::text[]",
    );
    expect(bcbaExactCapabilitySql).toContain(
      "ARRAY['admin', 'admin_schedule', 'therapist', 'midtier', 'bt', 'bcba']::text[]",
    );
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

  it('exposes the program-goal capability RPC through the public PostgREST schema only', () => {
    expect(exposeProgramGoalRpcSql).toContain(
      'CREATE OR REPLACE FUNCTION public.current_user_can_manage_programs_goals(target_organization_id uuid)',
    );
    expect(exposeProgramGoalRpcSql).toContain('SELECT app.current_user_can_manage_programs_goals(target_organization_id);');
    expect(exposeProgramGoalRpcSql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) FROM PUBLIC, anon;',
    );
    expect(exposeProgramGoalRpcSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;',
    );
    expect(exposeProgramGoalRpcSql).toContain("NOTIFY pgrst, 'reload schema';");
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
    expect(smokeSql).toContain('bcba_exact_capability_helpers');
    expect(smokeSql).toContain('not app.current_user_is_super_admin()');
  });

  it('lists editable employee roles from active unexpired junction grants only', () => {
    expect(employeeRoleListingSql).toContain('is_super_admin boolean := public.current_user_is_super_admin();');
    expect(employeeRoleListingSql).not.toContain("app.user_has_role('super_admin')");
    expect(employeeRoleListingSql).not.toContain("app.user_has_role('bcba')");
    expect(employeeRoleListingSql).toContain('FROM public.user_roles ur');
    expect(employeeRoleListingSql).toContain('JOIN public.roles r ON r.id = ur.role_id');
    expect(employeeRoleListingSql).toContain('COALESCE(ur.is_active, true) = true');
    expect(employeeRoleListingSql).toContain('(ur.expires_at IS NULL OR ur.expires_at > now())');
    expect(employeeRoleListingSql).toContain('effective_role.role');
    expect(employeeRoleListingSql).not.toContain('WHERE p.role <>');
  });

  it('adds a follow-up migration that makes super_admin outrank bcba in junction and listing helpers', () => {
    const junctionRoleFunction = extractSuperAdminPrecedenceFunction('public.get_user_role_from_junction');
    const employeeListingFunction = extractSuperAdminPrecedenceFunction('public.get_employee_users_paged');

    expect(junctionRoleFunction).toContain("WHEN 'super_admin' THEN 8");
    expect(junctionRoleFunction).toContain("WHEN 'bcba' THEN 7");
    expect(employeeListingFunction).toContain("WHEN 'super_admin' THEN 8");
    expect(employeeListingFunction).toContain("WHEN 'bcba' THEN 7");
  });

  it('restricts employee listing RPC execution to authenticated callers', () => {
    expect(employeeRoleListingGrantsSql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) FROM PUBLIC, anon;',
    );
    expect(employeeRoleListingGrantsSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO authenticated, service_role;',
    );
    expect(employeeRoleListingGrantsSql).toContain(
      '-- @migration-rollback: GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO PUBLIC, anon;',
    );
    expect(employeeRoleListingGrantsSql).toContain(
      '-- @migration-rollback: REVOKE EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) FROM service_role;',
    );
    expect(employeeRoleListingGrantsSql).toContain("-- @migration-rollback: NOTIFY pgrst, 'reload schema';");
    expect(employeeRoleListingGrantsSql).not.toContain(
      '-- @migration-rollback: GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO authenticated;',
    );
    expect(employeeRoleListingGrantsSql).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it('aligns session start RPC authorization with exact employee roles and linked BT identities', () => {
    const functionSql = extractStartSessionAuthzFunction('public.start_session_with_goals');

    expect(functionSql).toContain('public.current_user_is_super_admin()');
    expect(functionSql).toContain("array['admin', 'admin_schedule', 'midtier', 'bcba']::text[]");
    expect(functionSql).toContain('from public.user_therapist_links utl');
    expect(functionSql).toContain('utl.user_id = v_actor_id');
    expect(functionSql).toContain('utl.therapist_id = v_session.therapist_id');
    expect(functionSql).toContain("array['therapist', 'bt']::text[]");
    expect(functionSql).toContain('and v_session.therapist_id = v_actor_id');
    expect(functionSql).not.toContain("public.user_has_role_for_org('therapist'");
    expect(startSessionAuthzSql).toContain(
      'revoke execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) from anon;',
    );
    expect(startSessionAuthzSql).toContain("notify pgrst, 'reload schema';");
  });
});
