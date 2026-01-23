import { describe, expect, it } from 'vitest';
import { buildAdminCandidates } from '../scripts/check-role-drift';

describe('buildAdminCandidates', () => {
  it('filters to admin roles from metadata', () => {
    const candidates = buildAdminCandidates([
      {
        id: 'admin-id',
        email: 'admin@test.com',
        user_metadata: { role: 'admin' },
      },
      {
        id: 'super-id',
        email: 'super@test.com',
        user_metadata: { role: 'super_admin' },
      },
      {
        id: 'client-id',
        email: 'client@test.com',
        user_metadata: { role: 'client' },
      },
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.id)).toEqual(['admin-id', 'super-id']);
  });

  it('normalizes signup role variants', () => {
    const candidates = buildAdminCandidates([
      {
        id: 'superadmin-id',
        email: 'superadmin@test.com',
        user_metadata: { signupRole: 'SuperAdmin' },
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].metaRole).toBe('super_admin');
  });
});
