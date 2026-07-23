import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()
  .findLast((entry) => readFileSync(join(migrationsDir, entry), 'utf8').match(
    /create or replace function public\.resolve_assigned_bt_session_capture_billing\s*\(/i,
  ));

const sql = migrationName ? readFileSync(join(migrationsDir, migrationName), 'utf8') : '';

const functionBody = sql.match(
  /create or replace function public\.resolve_assigned_bt_session_capture_billing\s*\(\s*p_session_id\s+uuid\s*\)[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

describe('WIN-240 session capture billing resolver migration', () => {
  it('adds the assigned-BT billing resolver migration', () => {
    expect(migrationName).toBeTruthy();
    expect(functionBody).toContain('resolve_assigned_bt_session_capture_billing');
  });

  it('accepts only a session uuid and keeps the RPC security envelope narrow', () => {
    expect(functionBody).toMatch(/resolve_assigned_bt_session_capture_billing\s*\(\s*p_session_id\s+uuid\s*\)/i);
    expect(functionBody).not.toMatch(/p_organization_id|p_client_id|p_therapist_id|p_authorization_id|p_service_code|p_role|p_session_date/i);
    expect(functionBody).toMatch(/security definer/i);
    expect(functionBody).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/revoke execute on function public\.resolve_assigned_bt_session_capture_billing\(uuid\) from public,\s*anon/i);
    expect(sql).toMatch(/grant execute on function public\.resolve_assigned_bt_session_capture_billing\(uuid\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.resolve_assigned_bt_session_capture_billing\(uuid\) to authenticated,\s*service_role/i);
  });

  it('enforces exact BT, active therapist, org-scoped assignment, and capture capability checks', () => {
    expect(functionBody).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(functionBody).toMatch(/v_session\.organization_id <> app\.current_user_organization_id\(\)/i);
    expect(functionBody).toMatch(/from public\.therapists therapist[\s\S]*therapist\.organization_id = v_session\.organization_id[\s\S]*therapist\.status = 'active'[\s\S]*therapist\.deleted_at is null[\s\S]*upper\(btrim\(coalesce\(therapist\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(functionBody).toMatch(/v_session\.therapist_id = v_actor[\s\S]*from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = v_session\.therapist_id/i);
    expect(functionBody).toMatch(/current_user_can_capture_trial_event/i);
  });

  it('derives canonical strict or relaxed billing defaults from persisted session data only', () => {
    expect(functionBody).toMatch(/from public\.authorizations authz[\s\S]*authz\.organization_id = v_session\.organization_id[\s\S]*authz\.client_id = v_session\.client_id/i);
    expect(functionBody).toMatch(/authz\.status = 'approved'[\s\S]*v_session\.start_time::date between authz\.start_date and authz\.end_date/i);
    expect(functionBody).toMatch(/from public\.authorization_services service[\s\S]*service\.authorization_id = v_authorization\.id/i);
    expect(functionBody).toMatch(/service\.decision_status = 'approved'[\s\S]*v_session\.start_time::date between service\.from_date and service\.to_date/i);
    expect(functionBody).toMatch(/if not found and v_strict_billing then/i);
    expect(functionBody).toMatch(/v_service_code := 'UNSPECIFIED'/i);
    expect(functionBody).not.toMatch(/p_note_payload|requested_service_code|authorization_id\s*:=\s*p_/i);
  });

  it('returns minimal billing defaults plus canonical session write bindings', () => {
    const returnSignature = functionBody.match(/returns table\s*\([\s\S]*?\)/i)?.[0] ?? '';
    expect(returnSignature).toMatch(/returns table\s*\(\s*authorization_id\s+uuid\s*,\s*service_code\s+text\s*,\s*strict_billing\s+boolean\s*,\s*session_client_id\s+uuid\s*,\s*session_therapist_id\s+uuid\s*\)/i);
    expect(returnSignature).not.toMatch(/organization_id|session_id|authorization_number|approved_units/i);
    expect(functionBody).toMatch(/return query[\s\S]*select[\s\S]*v_authorization\.id[\s\S]*v_service_code[\s\S]*v_strict_billing[\s\S]*v_session\.client_id[\s\S]*v_session\.therapist_id/i);
  });

  it('reloads the PostgREST schema after exposing the RPC', () => {
    expect(sql).toMatch(/notify\s+pgrst\s*,\s*'reload schema'/i);
  });
});
