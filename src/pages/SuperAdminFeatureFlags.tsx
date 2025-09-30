import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { showError, showSuccess } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';

type JsonRecord = Record<string, unknown>;

type FeatureFlagRecord = {
  id: string;
  flag_key: string;
  description: string | null;
  default_enabled: boolean;
  metadata: JsonRecord | null;
};

type OrganizationRecord = {
  id: string;
  name: string | null;
  slug: string | null;
  metadata: JsonRecord | null;
};

type OrganizationFeatureFlagRecord = {
  id: string;
  organization_id: string;
  feature_flag_id: string;
  is_enabled: boolean;
};

type PlanRecord = {
  code: string;
  name: string;
  description: string | null;
  is_active: boolean | null;
};

type OrganizationPlanRecord = {
  organization_id: string;
  plan_code: string | null;
  notes: string | null;
};

type FeatureFlagPayload = {
  flags: FeatureFlagRecord[];
  organizations: OrganizationRecord[];
  organizationFlags: OrganizationFeatureFlagRecord[];
  organizationPlans: OrganizationPlanRecord[];
  plans: PlanRecord[];
};

const QUERY_KEY = ['super-admin', 'feature-flags'];

const humanizeKey = (value: string): string => {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
};

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const isValidUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const SuperAdminFeatureFlags: React.FC = () => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [newFlagKey, setNewFlagKey] = useState('');
  const [newFlagDescription, setNewFlagDescription] = useState('');
  const [newFlagDefaultEnabled, setNewFlagDefaultEnabled] = useState(false);

  const [organizationIdInput, setOrganizationIdInput] = useState('');
  const [organizationNameInput, setOrganizationNameInput] = useState('');
  const [organizationSlugInput, setOrganizationSlugInput] = useState('');

  const isSuperAdmin = profile?.role === 'super_admin';

  const featureFlagsQuery = useQuery<FeatureFlagPayload>({
    queryKey: QUERY_KEY,
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('feature-flags', {
        body: { action: 'list' },
      });

      if (error) {
        logger.error('Failed to load feature flag administration data', {
          error: toError(error, 'Feature flag list failed'),
        });
        throw error;
      }

      const payload = (data ?? {}) as Partial<FeatureFlagPayload>;
      return {
        flags: payload.flags ?? [],
        organizations: payload.organizations ?? [],
        organizationFlags: payload.organizationFlags ?? [],
        organizationPlans: payload.organizationPlans ?? [],
        plans: payload.plans ?? [],
      } satisfies FeatureFlagPayload;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createFlagMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('feature-flags', {
        body: {
          action: 'createFlag',
          flagKey: newFlagKey.trim(),
          description: newFlagDescription.trim() || undefined,
          defaultEnabled: newFlagDefaultEnabled,
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setNewFlagKey('');
      setNewFlagDescription('');
      setNewFlagDefaultEnabled(false);
      showSuccess('Feature flag created');
    },
    onError: error => {
      logger.error('Failed to create feature flag', {
        error: toError(error, 'Feature flag creation failed'),
      });
      showError(error);
    },
  });

  const updateGlobalFlagMutation = useMutation({
    mutationFn: async (variables: { flagId: string; enabled: boolean }) => {
      const { error } = await supabase.functions.invoke('feature-flags', {
        body: {
          action: 'updateGlobalFlag',
          flagId: variables.flagId,
          enabled: variables.enabled,
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      showSuccess('Feature flag updated');
    },
    onError: error => {
      logger.error('Failed to update global feature flag', {
        error: toError(error, 'Global feature flag update failed'),
      });
      showError(error);
    },
  });

  const setOrganizationFlagMutation = useMutation({
    mutationFn: async (variables: { organizationId: string; flagId: string; enabled: boolean }) => {
      const { error } = await supabase.functions.invoke('feature-flags', {
        body: {
          action: 'setOrgFlag',
          organizationId: variables.organizationId,
          flagId: variables.flagId,
          enabled: variables.enabled,
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      showSuccess('Organization feature flag updated');
    },
    onError: error => {
      logger.error('Failed to update organization feature flag', {
        error: toError(error, 'Organization feature flag update failed'),
      });
      showError(error);
    },
  });

  const setOrganizationPlanMutation = useMutation({
    mutationFn: async (variables: { organizationId: string; planCode: string | null }) => {
      const { error } = await supabase.functions.invoke('feature-flags', {
        body: {
          action: 'setOrgPlan',
          organizationId: variables.organizationId,
          planCode: variables.planCode,
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      showSuccess('Organization plan updated');
    },
    onError: error => {
      logger.error('Failed to update organization plan', {
        error: toError(error, 'Organization plan update failed'),
      });
      showError(error);
    },
  });

  const upsertOrganizationMutation = useMutation({
    mutationFn: async () => {
      const normalizedId = organizationIdInput.trim();
      if (!isValidUuid(normalizedId)) {
        throw new Error('Organization ID must be a valid UUID.');
      }

      const { error } = await supabase.functions.invoke('feature-flags', {
        body: {
          action: 'upsertOrganization',
          organization: {
            id: normalizedId,
            name: organizationNameInput.trim() || undefined,
            slug: organizationSlugInput.trim() ? toSlug(organizationSlugInput) : undefined,
          },
        },
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setOrganizationIdInput('');
      setOrganizationNameInput('');
      setOrganizationSlugInput('');
      showSuccess('Organization saved');
    },
    onError: error => {
      logger.error('Failed to upsert organization', {
        error: toError(error, 'Organization upsert failed'),
      });
      showError(error);
    },
  });

  const overridesByOrganization = useMemo(() => {
    const map = new Map<string, Map<string, OrganizationFeatureFlagRecord>>();
    featureFlagsQuery.data?.organizationFlags.forEach(record => {
      const orgMap = map.get(record.organization_id) ?? new Map<string, OrganizationFeatureFlagRecord>();
      orgMap.set(record.feature_flag_id, record);
      map.set(record.organization_id, orgMap);
    });
    return map;
  }, [featureFlagsQuery.data?.organizationFlags]);

  const plansByOrganization = useMemo(() => {
    const map = new Map<string, OrganizationPlanRecord>();
    featureFlagsQuery.data?.organizationPlans.forEach(plan => {
      map.set(plan.organization_id, plan);
    });
    return map;
  }, [featureFlagsQuery.data?.organizationPlans]);

  const activePlans = useMemo(
    () => (featureFlagsQuery.data?.plans ?? []).filter(plan => plan.is_active !== false),
    [featureFlagsQuery.data?.plans],
  );

  if (!isSuperAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Super Admin Feature Flags</h1>
        <p className="mt-4 text-sm text-slate-600">You must be a super admin to manage feature flags.</p>
      </div>
    );
  }

  const handleCreateFlag = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newFlagKey.trim()) {
      showError(new Error('Provide a flag key.'));
      return;
    }
    createFlagMutation.mutate();
  };

  const handleOrganizationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    upsertOrganizationMutation.mutate();
  };

  const flags = featureFlagsQuery.data?.flags ?? [];
  const organizations = featureFlagsQuery.data?.organizations ?? [];

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-semibold text-slate-900">Super Admin Feature Flags</h1>
      <p className="mt-2 text-sm text-slate-600">
        Manage global feature toggles, per-organization overrides, and plan assignments.
      </p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Register organization</h2>
        <p className="mt-1 text-sm text-slate-600">
          Register an organization ID before assigning plans or overrides. Use the UUID embedded in auth metadata.
        </p>
        <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleOrganizationSubmit}>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="organization-id">
              Organization ID
            </label>
            <input
              id="organization-id"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={organizationIdInput}
              onChange={event => setOrganizationIdInput(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              required
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="organization-name">
              Display name
            </label>
            <input
              id="organization-name"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={organizationNameInput}
              onChange={event => setOrganizationNameInput(event.target.value)}
              placeholder="Acme Behavioral"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="organization-slug">
              Slug (optional)
            </label>
            <input
              id="organization-slug"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={organizationSlugInput}
              onChange={event => setOrganizationSlugInput(event.target.value)}
              placeholder="acme-behavioral"
            />
          </div>
          <div className="md:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={upsertOrganizationMutation.isPending}
            >
              {upsertOrganizationMutation.isPending ? 'Saving…' : 'Save organization'}
            </button>
            <span className="text-xs text-slate-500">Existing organizations will be updated in place.</span>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Global feature flags</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleCreateFlag}>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="flag-key">
              Flag key
            </label>
            <input
              id="flag-key"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={newFlagKey}
              onChange={event => setNewFlagKey(event.target.value)}
              placeholder="new-dashboard"
              required
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="flag-description">
              Description
            </label>
            <input
              id="flag-description"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={newFlagDescription}
              onChange={event => setNewFlagDescription(event.target.value)}
              placeholder="Describe the experiment"
            />
          </div>
          <div className="md:col-span-1 flex items-center gap-2 pt-6">
            <input
              id="flag-default-enabled"
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={newFlagDefaultEnabled}
              onChange={event => setNewFlagDefaultEnabled(event.target.checked)}
            />
            <label className="text-sm text-slate-700" htmlFor="flag-default-enabled">
              Enabled by default
            </label>
          </div>
          <div className="md:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={createFlagMutation.isPending}
            >
              {createFlagMutation.isPending ? 'Creating…' : 'Create flag'}
            </button>
            <span className="text-xs text-slate-500">Flag keys cannot be changed after creation.</span>
          </div>
        </form>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Flag
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Description
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Default
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {flags.map(flag => (
                <tr key={flag.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-slate-800">
                    <span className="font-mono text-xs uppercase text-slate-500">{flag.flag_key}</span>
                    <div className="text-sm text-slate-800">{humanizeKey(flag.flag_key)}</div>
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-600">{flag.description ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600">
                    {flag.default_enabled ? 'Enabled' : 'Disabled'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600">
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                      onClick={() =>
                        updateGlobalFlagMutation.mutate({ flagId: flag.id, enabled: !flag.default_enabled })
                      }
                      disabled={updateGlobalFlagMutation.isPending}
                    >
                      {flag.default_enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {flags.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={4}>
                    No feature flags have been created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Organization overrides</h2>
          {featureFlagsQuery.isLoading && <span className="text-sm text-slate-500">Loading…</span>}
        </div>

        {organizations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">Register an organization to begin configuring overrides.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Organization
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Plan assignment
                  </th>
                  {flags.map(flag => (
                    <th
                      key={flag.id}
                      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      {humanizeKey(flag.flag_key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {organizations.map(org => {
                  const plan = plansByOrganization.get(org.id);
                  return (
                    <tr key={org.id}>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div className="font-medium text-slate-900">{org.name ?? 'Unnamed organization'}</div>
                        <div className="font-mono text-xs text-slate-500">{org.id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <label className="sr-only" htmlFor={`plan-${org.id}`}>
                          Plan assignment for {org.name ?? org.id}
                        </label>
                        <select
                          id={`plan-${org.id}`}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          value={plan?.plan_code ?? ''}
                          onChange={event =>
                            setOrganizationPlanMutation.mutate({
                              organizationId: org.id,
                              planCode: event.target.value ? event.target.value : null,
                            })
                          }
                          disabled={setOrganizationPlanMutation.isPending}
                        >
                          <option value="">No plan</option>
                          {activePlans.map(planOption => (
                            <option key={planOption.code} value={planOption.code}>
                              {planOption.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      {flags.map(flag => {
                        const override = overridesByOrganization.get(org.id)?.get(flag.id);
                        const effective = override ? override.is_enabled : flag.default_enabled;
                        return (
                          <td key={flag.id} className="px-4 py-3 text-sm text-slate-700">
                            <button
                              type="button"
                              className={`rounded-md px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                                effective
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                              aria-label={`${humanizeKey(flag.flag_key)} override for ${org.name ?? org.id}`}
                              onClick={() =>
                                setOrganizationFlagMutation.mutate({
                                  organizationId: org.id,
                                  flagId: flag.id,
                                  enabled: !effective,
                                })
                              }
                              disabled={setOrganizationFlagMutation.isPending}
                            >
                              {effective ? 'Enabled' : 'Disabled'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
