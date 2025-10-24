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
    .replace(/[^a-z0-9]+/g, '-')</n>    .replace(/^-+|-+$/g, '');
}

export default function OrganizationSettings() {
  const { user, profile } = useAuth();
  const [form, setForm] = useState<CreateOrgState>({ name: '', slug: '' });
  const [isSaving, setIsSaving] = useState(false);

  const callerOrgId = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const snake = typeof meta.organization_id === 'string' ? meta.organization_id : null;
    const camel = typeof meta.organizationId === 'string' ? meta.organizationId : null;
    return snake || camel || null;
  }, [user]);

  const canCreateOrg = useMemo(() => {
    if (profile?.role === 'super_admin') return true;
    // Admins without an org may create their initial org
    return profile?.role === 'admin' && !callerOrgId;
  }, [profile, callerOrgId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateOrg) return;

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
      if (profile?.role === 'admin' && !callerOrgId) {
        const { error: updateError } = await supabase.auth.updateUser({
          data: { organization_id: newOrgId },
        });
        if (updateError) {
          showError(updateError.message || 'Organization created, but failed to link your account');
          return;
        }
      }

      showSuccess(status === 201 ? 'Organization created' : 'Organization saved');
      setForm({ name: '', slug: '' });
    } catch (error) {
      showError(error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!canCreateOrg) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-slate-700 dark:border-slate-700 dark:bg-dark-lighter dark:text-slate-200">
        You do not have permission to create organizations.
      </div>
    );
  }

  return (
    <section>
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Organizations</h2>
      </div>

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
            disabled={isSaving}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {isSaving ? 'Saving…' : 'Create organization'}
          </button>
        </div>
      </form>

      {profile?.role === 'admin' && !callerOrgId && (
        <p className="mt-2 text-xs text-slate-500">Your account will be linked to the new organization automatically.</p>
      )}
    </section>
  );
}


