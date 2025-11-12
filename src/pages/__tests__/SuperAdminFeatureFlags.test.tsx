import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { SuperAdminFeatureFlags } from '../SuperAdminFeatureFlags';
import { supabase } from '../../lib/supabase';
import * as authContext from '../../lib/authContext';
import * as toast from '../../lib/toast';
import { logger } from '../../lib/logger/logger';

describe('SuperAdminFeatureFlags', () => {
  const invokeSpy = vi.spyOn(supabase.functions, 'invoke');
  const useAuthSpy = vi.spyOn(authContext, 'useAuth');
  const showSuccessSpy = vi.spyOn(toast, 'showSuccess');
  const showErrorSpy = vi.spyOn(toast, 'showError');
  const loggerSpy = vi.spyOn(logger, 'error');

  beforeEach(() => {
    invokeSpy.mockReset();
    showSuccessSpy.mockReset();
    showErrorSpy.mockReset();
    loggerSpy.mockReset();
    showSuccessSpy.mockImplementation(() => undefined);
    showErrorSpy.mockImplementation(() => undefined);
    loggerSpy.mockImplementation(() => undefined);
  });

  afterEach(() => {
    invokeSpy.mockReset();
    useAuthSpy.mockReset();
  });

  it('blocks non-super-admins from accessing the page', () => {
    useAuthSpy.mockReturnValue({ profile: { role: 'admin' } } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(screen.getByText(/You must be a super admin/i)).toBeInTheDocument();
  });

  it('allows super admins to manage flags, organizations, and plans', async () => {
    useAuthSpy.mockReturnValue({ profile: { role: 'super_admin' } } as unknown as ReturnType<typeof authContext.useAuth>);

    invokeSpy.mockImplementation(async (_path: string, options?: { body?: Record<string, unknown> }) => {
      const action = options?.body?.action;
      if (action === 'list') {
        return {
          data: {
            flags: [
              {
                id: 'flag-1',
                flag_key: 'beta-dashboard',
                description: 'Beta dashboard rollout',
                default_enabled: false,
                metadata: null,
              },
            ],
            organizations: [
              {
                id: 'org-1',
                name: 'Acme Behavioral',
                slug: 'acme-behavioral',
                metadata: null,
              },
            ],
            organizationFlags: [
              { id: 'override-1', organization_id: 'org-1', feature_flag_id: 'flag-1', is_enabled: true },
            ],
            organizationPlans: [{ organization_id: 'org-1', plan_code: 'standard', notes: null }],
            plans: [
              { code: 'standard', name: 'Standard', description: null, is_active: true },
              { code: 'professional', name: 'Professional', description: null, is_active: true },
            ],
          },
          error: null,
        };
      }

      return { data: { ok: true }, error: null };
    });

    renderWithProviders(<SuperAdminFeatureFlags />);

    await screen.findByText(/Super Admin Feature Flags/i);
    await screen.findByText(/beta dashboard rollout/i);

    await userEvent.type(screen.getByLabelText(/Flag key/i), 'session-audit');
    await userEvent.type(screen.getByLabelText(/Description/i), 'Session audit visibility');
    await userEvent.click(screen.getByLabelText(/Enabled by default/i));
    await userEvent.click(screen.getByRole('button', { name: /Create flag/i }));

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('feature-flags-v2', {
        body: expect.objectContaining({
          action: 'createFlag',
          flagKey: 'session-audit',
          description: 'Session audit visibility',
          defaultEnabled: true,
        }),
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /Enable/i }));

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('feature-flags-v2', {
        body: expect.objectContaining({ action: 'updateGlobalFlag', flagId: 'flag-1', enabled: true }),
      });
    });

    await userEvent.selectOptions(screen.getByLabelText(/Plan assignment/i), 'professional');

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('feature-flags-v2', {
        body: expect.objectContaining({ action: 'setOrgPlan', organizationId: 'org-1', planCode: 'professional' }),
      });
    });

    await userEvent.click(
      screen.getByRole('button', { name: /Beta Dashboard override for Acme Behavioral/i }),
    );

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('feature-flags-v2', {
        body: expect.objectContaining({ action: 'setOrgFlag', organizationId: 'org-1', flagId: 'flag-1', enabled: false }),
      });
    });

    expect(showSuccessSpy).toHaveBeenCalled();
    expect(showErrorSpy).not.toHaveBeenCalled();
    expect(loggerSpy).not.toHaveBeenCalledWith(
      'Failed to load feature flag administration data',
      expect.anything(),
    );
  });

  it('allows removing plan assignments', async () => {
    useAuthSpy.mockReturnValue({ profile: { role: 'super_admin' } } as unknown as ReturnType<typeof authContext.useAuth>);

    invokeSpy.mockImplementation(async (_path: string, options?: { body?: Record<string, unknown> }) => {
      const action = options?.body?.action;
      if (action === 'list') {
        return {
          data: {
            flags: [
              {
                id: 'flag-1',
                flag_key: 'beta-dashboard',
                description: null,
                default_enabled: false,
                metadata: null,
              },
            ],
            organizations: [
              {
                id: 'org-1',
                name: 'Acme Behavioral',
                slug: 'acme-behavioral',
                metadata: null,
              },
            ],
            organizationFlags: [],
            organizationPlans: [{ organization_id: 'org-1', plan_code: 'standard', notes: null }],
            plans: [
              { code: 'standard', name: 'Standard', description: null, is_active: true },
            ],
          },
          error: null,
        };
      }

      return { data: { ok: true }, error: null };
    });

    renderWithProviders(<SuperAdminFeatureFlags />);

    await screen.findByText(/Super Admin Feature Flags/i);

    const planSelect = await screen.findByLabelText(/Plan assignment for Acme Behavioral/i);
    await userEvent.selectOptions(planSelect, '');

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('feature-flags-v2', {
        body: expect.objectContaining({ action: 'setOrgPlan', organizationId: 'org-1', planCode: null }),
      });
    });
  });

  it('shows single-clinic lock messaging for super admins', () => {
    useAuthSpy.mockReturnValue({ profile: { role: 'super_admin' } } as unknown as ReturnType<typeof authContext.useAuth>);

    invokeSpy.mockResolvedValueOnce({
      data: {
        flags: [],
        organizations: [],
        organizationFlags: [],
        organizationPlans: [],
        plans: [],
      },
      error: null,
    });

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(screen.getByText(/Organization enrollment locked/i)).toBeInTheDocument();
    expect(screen.getByText(/single-clinic mode/i)).toBeInTheDocument();
  });
});
