import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { fetchStaffRecipients } from '../fetchStaffRecipients';

describe('fetchStaffRecipients', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('loads org staff via list_eligible_staff_for_messaging RPC', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          user_id: 'staff-2',
          full_name: 'Alex Admin',
          email: 'alex@test.com',
          role: 'admin',
        },
        {
          user_id: 'user-1',
          full_name: 'Self Therapist',
          email: 'therapist@test.com',
          role: 'therapist',
        },
      ],
      error: null,
    });

    const recipients = await fetchStaffRecipients('org-1', 'user-1');

    expect(rpcMock).toHaveBeenCalledWith('list_eligible_staff_for_messaging', {
      p_organization_id: 'org-1',
    });
    expect(recipients).toEqual([
      {
        id: 'staff-2',
        full_name: 'Alex Admin',
        email: 'alex@test.com',
        role: 'admin',
      },
    ]);
  });
});
