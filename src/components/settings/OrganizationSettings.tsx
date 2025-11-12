import React, { useMemo } from 'react';
import { Building2, Lock } from 'lucide-react';
import { useAuth } from '../../lib/authContext';
import { getDefaultOrganizationId } from '../../lib/runtimeConfig';

export default function OrganizationSettings() {
  const { effectiveRole, profile } = useAuth();
  const isSuperAdmin = effectiveRole === 'super_admin';
  const isAdmin = effectiveRole === 'admin';

  const defaultOrganizationId = useMemo(() => {
    try {
      return getDefaultOrganizationId();
    } catch {
      return null;
    }
  }, []);

  const roleLabel = profile?.role?.replace('_', ' ') ?? effectiveRole?.replace('_', ' ') ?? 'user';

  return (
    <section>
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Organizations</h2>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 dark:border-slate-700 dark:bg-dark-lighter dark:text-slate-200">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">Single-clinic mode active</p>
            <p className="mt-2">
              Multi-organization features are temporarily paused while we stabilise clinic workflows. All users are
              routed to the primary clinic and new organizations cannot be created in the UI.
            </p>
            {defaultOrganizationId ? (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Default clinic ID:&nbsp;
                <span className="font-mono text-xs">{defaultOrganizationId}</span>
              </p>
            ) : null}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Current access:&nbsp;
              <span className="font-semibold text-slate-700 dark:text-slate-200">{roleLabel}</span>. Contact the
              platform team if you need to perform an org migration during this freeze.
            </p>
            {(isSuperAdmin || isAdmin) && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                To adjust feature flags or plan overrides for the clinic, use the Super Admin Feature Flags console.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}


