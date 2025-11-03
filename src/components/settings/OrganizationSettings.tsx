import React, { useMemo, useState } from 'react';
import { Building2, PlusCircle } from 'lucide-react';
import { useAuth } from '../../lib/authContext';
import { edgeInvoke } from '../../lib/edgeInvoke';
import { supabase } from '../../lib/supabase';
import { showError, showSuccess } from '../../lib/toast';

type CreateOrgState = {
  name: string;
  slug: string;
};

function toKebabCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function OrganizationSettings() {
  const { user, profile, metadataRole, effectiveRole, roleMismatch } = useAuth();
  const [form, setForm] = useState<CreateOrgState>({ name: '', slug: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const callerOrgId = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const snake = typeof meta.organization_id === 'string' ? meta.organization_id : null;
    const camel = typeof meta.organizationId === 'string' ? meta.organizationId : null;
    return snake || camel || null;
  }, [user]);

  const resolvedRole = effectiveRole ?? profile?.role ?? metadataRole ?? null;

  const hasOrgAccess = resolvedRole === 'admin' || resolvedRole === 'super_admin';
  const hasOrgLock = resolvedRole === 'admin' && Boolean(callerOrgId);
  const metadataPending = !profile?.role && Boolean(metadataRole);

  const canSubmit =
    hasOrgAccess &&
    !hasOrgLock &&
    (!roleMismatch || resolvedRole === 'super_admin') &&
    (!metadataPending || resolvedRole === 'super_admin');

  const disabledReason = useMemo(() => {
    if (!hasOrgAccess) {
      return 'Only admins or super admins can create organizations.';
    }
    if (hasOrgLock) {
      return 'Admins already linked to an organization cannot create additional organizations.';
    }
    if (roleMismatch && resolvedRole !== 'super_admin') {
      return 'Your admin access is still syncing. Please sign out and back in, or contact support if the issue persists.';
    }
    if (metadataPending && resolvedRole !== 'super_admin') {
      return 'Your admin privileges are still syncing. Please wait a moment and try again.';
    }
    return undefined;
  }, [resolvedRole, hasOrgAccess, hasOrgLock, metadataPending, roleMismatch]);

  const metadataRoleLabel = metadataRole ? metadataRole.replace('_', ' ') : null;
  const profileRoleLabel = profile?.role ? profile.role.replace('_', ' ') : null;
  const effectiveRoleLabel = resolvedRole ? resolvedRole.replace('_', ' ') : 'current role';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      if (hasOrgLock) {
        showError('Your account is already linked to an organization. Contact a super admin to add additional organizations.');
      } else if (!hasOrgAccess) {
        showError('You do not have permission to create organizations.');
      } else if (roleMismatch) {
        showError('Your admin access is still syncing. Please try again shortly.');
      }
      return;
    }

    const trimmedName = form.name.trim();
    const trimmedSlug = form.slug.trim() ? toKebabCase(form.slug) : '';
    if (trimmedName.length === 0) {
      showError('Organization name is required');
      return;
    }

    setIsSaving(true);
    const newOrgId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);

    try {
      const { error: upsertError, status } = await edgeInvoke('feature-flags', {
        body: {
          action: 'upsertOrganization',
          organization: {
            id: newOrgId,
            name: trimmedName,
            slug: trimmedSlug || undefined,
          },
        },
      });

      if (upsertError) {
        showError(upsertError.message || 'Failed to create organization');
        return;
      }

      // If admin without org, assign themselves to the new org
      if (effectiveRole === 'admin' && !callerOrgId) {
        const { error: updateError } = await supabase.auth.updateUser({
          data: { organization_id: newOrgId },
        });
        if (updateError) {
          showError(updateError.message || 'Organization created, but failed to link your account');
          return;
        }
      }

      const msg = status === 201 ? 'Organization created' : 'Organization saved';
      showSuccess(msg);
      setStatusMessage(msg);
      setForm({ name: '', slug: '' });
    } catch (error) {
      showError(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Organizations</h2>
      </div>

      {!hasOrgAccess && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-dark-lighter dark:text-slate-200">
          Your current access level (<span className="font-medium">{effectiveRoleLabel}</span>) does not permit organization management. Please contact a workspace administrator if you believe this is incorrect.
        </div>
      )}

      {hasOrgAccess && roleMismatch && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          We detected a mismatch between your profile role{profileRoleLabel ? (
            <> (<span className="font-medium">{profileRoleLabel}</span>)</>
          ) : null} and your account metadata{metadataRoleLabel ? (
            <> (<span className="font-medium">{metadataRoleLabel}</span>)</>
          ) : null}. We will honour the metadata role for now, but if this persists after refreshing, please contact support.
        </div>
      )}

      {metadataPending && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
          Your profile record is still syncing. Using your account metadata role (<span className="font-medium">{metadataRoleLabel}</span>) until the sync completes.
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          <label htmlFor="org-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Organization name</label>
          <input
            id="org-name"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-dark dark:text-slate-200"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Acme Behavioral"
            required
          />
        </div>
        <div className="md:col-span-1">
          <label htmlFor="org-slug" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Slug (optional)</label>
          <input
            id="org-slug"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-dark dark:text-slate-200"
            value={form.slug}
            onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
            placeholder="acme-behavioral"
          />
        </div>
        <div className="md:col-span-1 flex items-end">
          <button
            type="submit"
            disabled={isSaving || !canSubmit}
            title={disabledReason}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {isSaving ? 'Saving…' : 'Create organization'}
          </button>
        </div>
      </form>

      {statusMessage && (
        <p role="status" aria-live="polite" className="sr-only">
          {statusMessage}
        </p>
      )}

      {effectiveRole === 'admin' && !callerOrgId && (
        <p className="mt-2 text-xs text-slate-500">Your account will be linked to the new organization automatically.</p>
      )}

      {hasOrgLock && (
        <p className="mt-2 text-xs text-slate-500">Your account is already associated with an organization. Reach out to a super admin if you need to manage additional organizations.</p>
      )}
    </section>
  );
}


