import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { SuperAdminFeatureFlags } from '../SuperAdminFeatureFlags';
import * as edgeInvokeModule from '../../lib/edgeInvoke';
import * as authContext from '../../lib/authContext';
import * as toast from '../../lib/toast';
import { logger } from '../../lib/logger/logger';

describe('SuperAdminFeatureFlags', () => {
  const invokeSpy = vi.spyOn(edgeInvokeModule, 'edgeInvoke');
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
    onlineManager.setOnline(true);
    invokeSpy.mockReset();
    useAuthSpy.mockReset();
  });

  it('blocks non-super-admins from accessing the page', () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'admin' },
      effectiveRole: 'admin',
      hasCapability: () => false,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(screen.getByText(/You must be a super admin/i)).toBeInTheDocument();
  });

  it('allows super admins to manage flags, organizations, and plans', async () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

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
          status: 200,
        };
      }

      return { data: { ok: true }, error: null, status: 200 };
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
  }, 15000);

  it('allows removing plan assignments', async () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

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
          status: 200,
        };
      }

      return { data: { ok: true }, error: null, status: 200 };
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

  it('shows single-clinic lock messaging for super admins', async () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    invokeSpy.mockResolvedValueOnce({
      data: {
        flags: [],
        organizations: [],
        organizationFlags: [],
        organizationPlans: [],
        plans: [],
      },
      error: null,
      status: 200,
    });

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(screen.getByText(/Organization enrollment locked/i)).toBeInTheDocument();
    expect(screen.getByText(/single-clinic mode/i)).toBeInTheDocument();
    expect(await screen.findByText(/No organization records are available yet/i)).toBeInTheDocument();
  });

  it('shows only the loading state while organization overrides are still pending', async () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    const unresolvedList = new Promise<{
      data: {
        flags: never[];
        organizations: never[];
        organizationFlags: never[];
        organizationPlans: never[];
        plans: never[];
      };
      error: null;
      status: 200;
    }>(() => undefined);

    invokeSpy.mockImplementation(async (_path: string, options?: { body?: Record<string, unknown> }) => {
      if (options?.body?.action === 'list') {
        return unresolvedList;
      }

      return { data: { ok: true }, error: null, status: 200 };
    });

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/No organization records are available yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Plan assignment/i })).not.toBeInTheDocument();
  });

  it('keeps terminal organization states hidden while the initial query is paused', async () => {
    useAuthSpy.mockReturnValue({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);
    onlineManager.setOnline(false);

    renderWithProviders(<SuperAdminFeatureFlags />);

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/No organization records are available yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Plan assignment/i })).not.toBeInTheDocument();
  });
});
