import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

const signupRoleMigrationPath = readdirSync(migrationsDir)
  .filter((name) => name.includes('signup_role') && name.endsWith('.sql'))
  .sort()
  .at(-1);

if (!signupRoleMigrationPath) {
  throw new Error('Expected at least one signup role migration');
}

const signupRoleMigration = readFileSync(join(migrationsDir, signupRoleMigrationPath), 'utf8');

describe('signup role alignment migration contract', () => {
  it('maps bt and legacy therapist metadata to bt while preserving client/guardian downgrade behavior', () => {
    expect(signupRoleMigration).toMatch(/create or replace function app\.resolve_signup_role\(p_metadata jsonb\)/i);
    expect(signupRoleMigration).toMatch(/v_guardian_raw text := lower\(btrim\(coalesce\(v_metadata->>'guardian_signup', ''\)\)\);/i);
    expect(signupRoleMigration).toMatch(/v_guardian boolean := v_guardian_raw in \('true', 't', '1', 'yes', 'on'\);/i);
    expect(signupRoleMigration).toMatch(/if v_guardian or v_role = 'guardian' then\s+return 'client';\s+end if;\s+if v_role = '' then\s+return null;/i);
    expect(signupRoleMigration).toMatch(/if v_role = 'client' then\s+return 'client';/i);
    expect(signupRoleMigration).toMatch(/if v_role in \('bt', 'therapist'\) then\s+return 'bt';/i);
  });

  it('rejects privileged or unknown signup metadata roles without unsafe boolean casts', () => {
    expect(signupRoleMigration).not.toMatch(/::boolean/i);
    expect(signupRoleMigration).not.toMatch(/if v_role in \('client', 'bt', 'therapist', 'admin', 'super_admin'/i);
    expect(signupRoleMigration).not.toMatch(/return 'admin';/i);
    expect(signupRoleMigration).not.toMatch(/return 'super_admin';/i);
    expect(signupRoleMigration).toMatch(/return null;/i);
  });
});
