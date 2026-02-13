import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('../runtimeConfig', () => ({
  getDefaultOrganizationId: vi.fn(() => '5238e88b-6198-4862-80a2-dbe15bbeabdd'),
}));

import { resolveOrganizationId } from '../organization';

describe('resolveOrganizationId', () => {
  it('returns null when no authenticated context is present', () => {
    expect(resolveOrganizationId({ user: null, profile: null })).toBeNull();
  });

  it('uses metadata organization id when authenticated user exists', () => {
    const user = {
      user_metadata: {
        organization_id: 'org-from-user',
      },
    };

    expect(resolveOrganizationId({ user: user as unknown as User, profile: null })).toBe('org-from-user');
  });
});
