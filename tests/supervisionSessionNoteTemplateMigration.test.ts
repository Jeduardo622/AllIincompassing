import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('supervision session note template seed migration', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260629225100_seed_supervision_session_note_template.sql',
    ),
    'utf-8',
  );
  const templateJsonMatch = migrationSql.match(/\$\$(\{[\s\S]*?\})\$\$::jsonb as template_structure/);
  const templateStructure = JSON.parse(templateJsonMatch?.[1] ?? '{}') as {
    workflow?: {
      trigger?: string;
      assigned_role?: string;
      notification?: { recipient_role?: string; reason?: string };
    };
    sections?: Array<{
      key: string;
      fields: Array<{
        key: string;
        type?: string;
        required?: boolean;
        options?: string[];
        other_field_key?: string;
        required_when?: string;
      }>;
    }>;
  };
  const fields = templateStructure.sections?.flatMap((section) => section.fields) ?? [];
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  it('seeds the extracted template into session_note_templates only', () => {
    expect(migrationSql).toMatch(/insert into public\.session_note_templates/i);
    expect(migrationSql).toMatch(/'supervision_session_note'::text/);
    expect(migrationSql).toMatch(/as template_type/i);
    expect(migrationSql).toMatch(/is_california_compliant/i);
    expect(migrationSql).toMatch(/compliance_requirements/i);
    expect(migrationSql).not.toMatch(/create table/i);
    expect(migrationSql).not.toMatch(/alter table/i);
    expect(migrationSql).not.toMatch(/create policy/i);
  });

  it('does not overwrite existing tenant template content', () => {
    expect(migrationSql).not.toMatch(/\bupdate\s+public\.session_note_templates\b/i);
    expect(migrationSql).toMatch(/where not exists \(\s+select 1\s+from public\.session_note_templates existing/i);
    expect(migrationSql).toMatch(/existing\.organization_id = organizations\.id/i);
    expect(migrationSql).toMatch(/existing\.template_name = extracted_template\.template_name/i);
    expect(migrationSql).toMatch(/existing\.template_type = extracted_template\.template_type/i);
  });

  it('captures the post-BT session workflow handoff metadata', () => {
    expect(templateStructure.workflow).toEqual({
      trigger: 'bt_session_finished',
      assigned_role: 'supervising_admin',
      notification: {
        recipient_role: 'supervising_admin',
        reason: 'complete_supervision_session_note',
      },
    });
  });

  it('captures all visible required screenshot field groups', () => {
    [
      'place_of_service',
      'billing_code',
      'purpose_of_session',
      'supervision_goal_updates',
      'daily_summary_data_points_scope',
      'rbt_in_attendance',
      'rbt_support_received',
      'skill_strategies_interventions_used',
      'behavior_strategies_interventions_used',
      'coordination_of_care',
      'team_members_involved',
      'focus_of_collaboration',
      'client_response_to_treatment',
      'session_note_description',
      'mid_tier_supervisor_signature',
      'bcba_supervisor_signature',
      'parent_guardian_digital_signature',
      'rbt_bt_licensure_credential',
    ].forEach((fieldKey) => {
      expect(fieldByKey.has(fieldKey)).toBe(true);
    });
  });

  it('includes the extracted checkbox and radio options from the PNG', () => {
    const options = fields.flatMap((field) => field.options ?? []);
    [
      'Direct Supervision',
      'Assessment or Ongoing Assessment',
      'Treatment Planning',
      'Parent Training',
      'Include Only Linked Data Points',
      'Include ALL data points',
      'N/A RBT/BT was not present during session',
      'Modeled strategies/interventions',
      'Discrete Trial Training',
      'Functional Communication Training',
      'No team collaboration occurred during this session',
      'The following collaboration occurred',
    ].forEach((optionLabel) => {
      expect(options).toContain(optionLabel);
    });
  });

  it('keeps other fields linked to their dependent text inputs', () => {
    expect(fieldByKey.get('purpose_of_session')?.other_field_key).toBe('purpose_of_session_other');
    expect(fieldByKey.get('purpose_of_session_other')?.required_when).toBe('purpose_of_session includes Other');
    expect(fieldByKey.get('rbt_support_received')?.other_field_key).toBe('rbt_support_other');
    expect(fieldByKey.get('rbt_support_other')?.required_when).toBe('rbt_support_received includes Other');
    expect(fieldByKey.get('skill_strategies_interventions_used')?.other_field_key).toBe('skill_strategies_other');
    expect(fieldByKey.get('skill_strategies_other')?.required_when).toBe(
      'skill_strategies_interventions_used includes Other',
    );
    expect(fieldByKey.get('behavior_strategies_interventions_used')?.other_field_key).toBe('behavior_strategies_other');
    expect(fieldByKey.get('behavior_strategies_other')?.required_when).toBe(
      'behavior_strategies_interventions_used includes Other',
    );
  });
});
