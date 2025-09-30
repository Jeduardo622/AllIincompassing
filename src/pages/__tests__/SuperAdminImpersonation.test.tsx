import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '../../test/utils';
import { SuperAdminImpersonation } from '../SuperAdminImpersonation';
import { supabase } from '../../lib/supabase';
import * as authContext from '../../lib/authContext';
import * as toast from '../../lib/toast';
import { logger } from '../../lib/logger/logger';

const selectMock = vi.fn();
const orderMock = vi.fn();
let invokeSpy: ReturnType<typeof vi.spyOn>;
let fromSpy: ReturnType<typeof vi.spyOn>;
let useAuthSpy: ReturnType<typeof vi.spyOn>;
let showSuccessSpy: ReturnType<typeof vi.spyOn>;
let showErrorSpy: ReturnType<typeof vi.spyOn>;
let loggerSpy: ReturnType<typeof vi.spyOn>;
const originalConfirm = window.confirm;

beforeEach(() => {
  window.confirm = vi.fn(() => true);
  selectMock.mockReset();
  orderMock.mockReset();

  invokeSpy = vi.spyOn(supabase.functions, 'invoke');
  fromSpy = vi.spyOn(supabase, 'from');
  orderMock.mockResolvedValue({ data: [], error: null });
  fromSpy.mockImplementation(() => ({
    select: (...args: unknown[]) => {
      selectMock(...args);
      return { order: orderMock };
    },
  }));

  useAuthSpy = vi.spyOn(authContext, 'useAuth');
  useAuthSpy.mockReturnValue({
    user: { user_metadata: { organization_id: 'org-123' } },
    profile: { role: 'super_admin' },
  } as unknown as ReturnType<typeof authContext.useAuth>);

  showSuccessSpy = vi.spyOn(toast, 'showSuccess').mockImplementation(() => undefined);
  showErrorSpy = vi.spyOn(toast, 'showError').mockImplementation(() => undefined);
  loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  window.confirm = originalConfirm;
  invokeSpy.mockRestore();
  fromSpy.mockRestore();
  useAuthSpy.mockRestore();
  showSuccessSpy.mockRestore();
  showErrorSpy.mockRestore();
  loggerSpy.mockRestore();
  selectMock.mockReset();
  orderMock.mockReset();
});

describe('SuperAdminImpersonation page', () => {
  it('submits impersonation issuance with sanitized payload', async () => {
    invokeSpy.mockResolvedValue({
      data: { token: 'token-123', expiresAt: '2025-06-01T12:15:00.000Z', auditId: 'audit-1', expiresInMinutes: 30 },
      error: null,
    });

    renderWithProviders(<SuperAdminImpersonation />);

    await userEvent.type(screen.getByLabelText(/Target user ID/i), 'user-456');
    await userEvent.clear(screen.getByLabelText(/Duration/i));
    await userEvent.type(screen.getByLabelText(/Duration/i), '45');
    await userEvent.clear(screen.getByLabelText(/Reason/i));
    await userEvent.type(screen.getByLabelText(/Reason/i), '  Investigate downtime  ');

    await userEvent.click(screen.getByRole('button', { name: /Issue impersonation token/i }));

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('super-admin-impersonate', {
        body: {
          action: 'issue',
          targetUserId: 'user-456',
          targetUserEmail: undefined,
          expiresInMinutes: 30,
          reason: 'Investigate downtime',
        },
      });
    });

    expect(showSuccessSpy).toHaveBeenCalled();
  });

  it('automatically revokes expired impersonation tokens', async () => {
    const expiredEntry = {
      id: 'audit-auto',
      actor_user_id: 'admin-1',
      target_user_id: 'user-1',
      actor_organization_id: 'org-123',
      target_organization_id: 'org-123',
      token_jti: 'token-jti',
      issued_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      revoked_at: null,
      reason: 'Expired automatically',
    };

    orderMock.mockResolvedValueOnce({ data: [expiredEntry], error: null });
    invokeSpy.mockResolvedValue({ data: { revoked: true, auditId: 'audit-auto' }, error: null });

    renderWithProviders(<SuperAdminImpersonation />);

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('super-admin-impersonate', {
        body: { action: 'revoke', auditId: 'audit-auto' },
      });
    });

    expect(showSuccessSpy).not.toHaveBeenCalled();
    expect(showErrorSpy).not.toHaveBeenCalled();
  });
});
