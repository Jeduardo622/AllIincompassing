import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import { ProfileTab } from '../TherapistDetails/ProfileTab';

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    hasCapability: vi.fn(() => false),
    hasRole: vi.fn(() => false),
    profile: { id: 'admin-user-id', organization_id: 'org-1' },
    user: { user_metadata: {} },
    effectiveRole: 'admin',
  }),
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../TherapistModal', () => ({
  TherapistModal: () => null,
}));

vi.mock('../settings/StaffInviteModal', () => ({
  StaffInviteModal: () => null,
}));

describe('Therapist ProfileTab', () => {
  it('shows empty states instead of seeded mock notes and issues', () => {
    renderWithProviders(
      <ProfileTab
        therapist={{
          id: 'therapist-1',
          full_name: 'Alex Therapist',
          email: 'alex@example.com',
          specialties: ['ABA Therapy'],
        }}
      />,
    );

    expect(screen.getByText(/No notes found\. Add your first note to get started\./i)).toBeInTheDocument();
    expect(screen.getByText(/No issues currently logged for this therapist/i)).toBeInTheDocument();
    expect(screen.queryByText(/Completed annual HIPAA training/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RBT certification expires in 30 days/i)).not.toBeInTheDocument();
  });
});
