import type React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import { UserSettings } from '../UserSettings';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
    },
  },
}));

vi.mock('../../../lib/toast', () => ({
  showSuccess: mocks.showSuccess,
  showError: mocks.showError,
}));

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    user: {
      id: 'bt-user-id',
      email: 'bt@example.com',
      user_metadata: {},
    },
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('UserSettings password changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'bt-user-id' } }, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user: { id: 'bt-user-id' } }, error: null });
  });

  it('verifies the current password before changing to a new password', async () => {
    renderWithProviders(<UserSettings />, {
      auth: { role: 'bt', userId: 'bt-user-id', email: 'bt@example.com' },
    });

    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/^Current Password$/i), 'OldPass123!');
    await userEvent.type(screen.getByLabelText(/^New Password$/i), 'NewPass123!');
    await userEvent.type(screen.getByLabelText(/^Confirm New Password$/i), 'NewPass123!');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'bt@example.com',
        password: 'OldPass123!',
      });
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      email: 'bt@example.com',
      data: {
        first_name: '',
        last_name: '',
        title: '',
      },
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'NewPass123!' });
    expect(mocks.showSuccess).toHaveBeenCalledWith('Profile updated successfully');
  });

  it('does not update the password when current password verification fails', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new Error('Invalid login credentials'),
    });

    renderWithProviders(<UserSettings />, {
      auth: { role: 'bt', userId: 'bt-user-id', email: 'bt@example.com' },
    });

    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await userEvent.type(screen.getByLabelText(/^Current Password$/i), 'WrongPass123!');
    await userEvent.type(screen.getByLabelText(/^New Password$/i), 'NewPass123!');
    await userEvent.type(screen.getByLabelText(/^Confirm New Password$/i), 'NewPass123!');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mocks.showError).toHaveBeenCalled();
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
