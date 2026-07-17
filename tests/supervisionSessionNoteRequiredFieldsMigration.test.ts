import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('supervision session note required fields migration', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260717144005_require_supervision_session_note_fields.sql',
    ),
    'utf-8',
  );

  it('updates only supervision session note templates', () => {
    expect(migrationSql).toMatch(/update public\.session_note_templates/i);
    expect(migrationSql).toMatch(/where template\.(?:template_type|template_name)\s*=\s*'supervision_session_note'/i);
    expect(migrationSql).toMatch(/template\.template_name\s*=\s*'Supervision Session Note'/i);
  });

  it('marks the requested supervisor note fields as required', () => {
    expect(migrationSql).toMatch(/jsonb_set\(field\.value,\s*'\{required\}',\s*'true'::jsonb,\s*true\)/i);
    [
      'rbt_in_attendance',
      'skill_strategies_interventions_used',
      'behavior_strategies_interventions_used',
      'coordination_of_care',
      'client_response_to_treatment',
      'session_note_description',
    ].forEach((fieldKey) => {
      expect(migrationSql).toContain(`'${fieldKey}'`);
    });
  });

  it('fails closed when an organization is missing its supervision template', () => {
    expect(migrationSql).toMatch(/from public\.organizations(?:\s+as)?\s+organization/i);
    expect(migrationSql).toMatch(/where not exists\s*\([\s\S]*template\.organization_id\s*=\s*organization\.id/i);
    expect(migrationSql).toMatch(/raise exception 'Missing Supervision Session Note template for % organization rows'/i);
  });
});
