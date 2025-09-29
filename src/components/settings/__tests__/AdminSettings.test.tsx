import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent, within } from '../../../test/utils';
import AdminSettings from '../AdminSettings';
import { supabase } from '../../../lib/supabase';
import { logger } from '../../../lib/logger/logger';
import { useAuth } from '../../../lib/authContext';

vi.mock('../../../lib/logger/logger', () => {
  const info = vi.fn();
  const error = vi.fn();
  const warn = vi.fn();
  const debug = vi.fn();
  return {
    logger: { info, error, warn, debug },
    info,
    error,
    warn,
    debug
  };
});

vi.mock('../../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

const rpcMock = vi.mocked(supabase.rpc);
const defaultRpcImplementation = rpcMock.getMockImplementation();
const fallbackRpc = defaultRpcImplementation
  ?? (async (_functionName: string, _params?: Record<string, unknown>) => ({ data: null, error: null }));

let confirmSpy: ReturnType<typeof vi.spyOn> | null = null;

const mockAdminUser = {
  id: 'admin-id',
  user_id: 'user-123',
  email: 'admin@example.com',
  created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
  raw_user_meta_data: {
    first_name: 'Ada',
    last_name: 'Admin',
    title: 'Administrator'
  }
};

describe('AdminSettings logging', () => {
  beforeEach(() => {
    const authStub = {
      user: {
        user_metadata: {
          organization_id: '11111111-1111-1111-1111-111111111111'
        }
      },
      profile: null,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn(() => true),
      hasAnyRole: vi.fn(() => true),
      isAdmin: vi.fn(() => true),
      isSuperAdmin: vi.fn(() => false)
    } as unknown as ReturnType<typeof useAuth>;
    vi.mocked(useAuth).mockReturnValue(authStub);
    rpcMock.mockClear();
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    rpcMock.mockImplementation(async (functionName: string, params?: Record<string, unknown>) => {
      if (functionName === 'get_admin_users') {
        expect(params).toMatchObject({ organization_id: '11111111-1111-1111-1111-111111111111' });
        return { data: [mockAdminUser], error: null };
      }
      if (functionName === 'manage_admin_users') {
        expect(params).toMatchObject({
          operation: 'remove',
          target_user_id: mockAdminUser.user_id
        });
        return { data: null, error: new Error('failed to remove admin') };
      }
      if (defaultRpcImplementation) {
        return defaultRpcImplementation(functionName, params as never);
      }
      return fallbackRpc(functionName, params);
    });
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    rpcMock.mockImplementation(defaultRpcImplementation ?? fallbackRpc);
    confirmSpy?.mockRestore();
    confirmSpy = null;
  });

  it('logs errors when admin removal fails', async () => {
    renderWithProviders(<AdminSettings />);

    const removeButton = await screen.findByTitle('Remove admin');
    await userEvent.click(removeButton);

    await waitFor(() => {
      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([message, options]) =>
          message === 'Admin removal RPC failed'
          && options?.context?.component === 'AdminSettings'
          && options?.context?.operation === 'removeAdminRpc'
        )
      ).toBe(true);
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        'manage_admin_users',
        expect.objectContaining({ operation: 'remove', target_user_id: mockAdminUser.user_id })
      );
    });
  });

  it('adds organization metadata when creating an admin user', async () => {
    const assignAdminSpy = vi.fn();
    const originalSignUp = (supabase.auth as { signUp?: (...args: unknown[]) => unknown }).signUp;
    const signUpMock = vi.fn().mockResolvedValue({ data: {}, error: null });
    (supabase.auth as Record<string, unknown>).signUp = signUpMock;

    rpcMock.mockImplementation(async (functionName: string, params?: Record<string, unknown>) => {
      if (functionName === 'get_admin_users') {
        return { data: [mockAdminUser], error: null };
      }

      if (functionName === 'assign_admin_role') {
        assignAdminSpy(params);
        return { data: null, error: null };
      }

      if (functionName === 'manage_admin_users') {
        return { data: null, error: null };
      }

      if (defaultRpcImplementation) {
        return defaultRpcImplementation(functionName, params as never);
      }

      return fallbackRpc(functionName, params);
    });

    try {
      renderWithProviders(<AdminSettings />);

      await userEvent.click(await screen.findByText('Add Admin'));

      const modal = await screen.findByRole('dialog', { name: 'Add New Admin' });
      await userEvent.type(within(modal).getByLabelText('Email*'), 'new.admin@example.com');
      await userEvent.type(within(modal).getByLabelText('Password*'), 'StrongPass123!');
      await userEvent.type(within(modal).getByLabelText('First Name*'), 'New');
      await userEvent.type(within(modal).getByLabelText('Last Name*'), 'Admin');

      const submitButton = within(modal).getByRole('button', { name: 'Add Admin' });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(signUpMock).toHaveBeenCalled();
      });

      const signUpOptions = signUpMock.mock.calls[0]?.[0];
      expect(signUpOptions?.options?.data?.organization_id).toBe('11111111-1111-1111-1111-111111111111');
      expect(assignAdminSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_email: 'new.admin@example.com',
          organization_id: '11111111-1111-1111-1111-111111111111',
        })
      );
    } finally {
      if (originalSignUp) {
        (supabase.auth as Record<string, unknown>).signUp = originalSignUp;
      } else {
        delete (supabase.auth as Record<string, unknown>).signUp;
      }
    }
  });
});
