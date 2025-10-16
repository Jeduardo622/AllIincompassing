import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { showSuccess, showError } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';
import {
  buildImpersonationIssuePayload,
  DEFAULT_IMPERSONATION_MINUTES,
  getExpiryCountdownLabel,
  ImpersonationAuditRecord,
  MAX_IMPERSONATION_MINUTES,
  MIN_IMPERSONATION_MINUTES,
  shouldAutoRevoke,
  validateImpersonationScope,
} from '../lib/impersonation';

const resolveOrganizationId = (metadata: Record<string, unknown> | null | undefined): string | null => {
  if (!metadata) return null;
  const orgId = metadata.organization_id;
  if (typeof orgId === 'string' && orgId.length > 0) {
    return orgId;
  }
  const camel = metadata.organizationId;
  if (typeof camel === 'string' && camel.length > 0) {
    return camel;
  }
  return null;
};

export const SuperAdminImpersonation: React.FC = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [targetUserId, setTargetUserId] = useState('');
  const [targetUserEmail, setTargetUserEmail] = useState('');
  const [targetOrganizationId, setTargetOrganizationId] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState<number>(DEFAULT_IMPERSONATION_MINUTES);
  const [reason, setReason] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedExpiresAt, setIssuedExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const autoRevokedRef = useRef<Set<string>>(new Set());

  const actorOrganizationId = useMemo(() => {
    const metadata = user?.user_metadata as Record<string, unknown> | undefined;
    return resolveOrganizationId(metadata ?? null);
  }, [user]);

  useEffect(() => {
    if (actorOrganizationId && !targetOrganizationId) {
      setTargetOrganizationId(actorOrganizationId);
    }
  }, [actorOrganizationId, targetOrganizationId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const impersonationsQuery = useQuery({
    queryKey: ['impersonation-audit'],
    enabled: profile?.role === 'super_admin',
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('impersonation_audit')
        .select(`
          id,
          actor_user_id,
          target_user_id,
          actor_organization_id,
          target_organization_id,
          token_jti,
          issued_at,
          expires_at,
          revoked_at,
          reason
        `)
        .order('issued_at', { ascending: false });

      if (error) {
        logger.error('Failed to load impersonation audit entries', {
          error: toError(error, 'Impersonation audit fetch failed'),
        });
        throw error;
      }

      return (data ?? []) as ImpersonationAuditRecord[];
    },
  });

  const issueMutation = useMutation<
    { token: string; expiresAt: string; auditId: string; expiresInMinutes: number },
    Error,
    void
  >({
    mutationFn: async () => {
      const payload = buildImpersonationIssuePayload({
        actorOrganizationId,
        targetOrganizationId,
        targetUserId: targetUserId.trim() || undefined,
        targetUserEmail: targetUserEmail.trim() || undefined,
        requestedMinutes: expiresInMinutes,
        reason,
      });

      const { data, error } = await supabase.functions.invoke('super-admin-impersonate', {
        body: payload.body,
      });

      if (error) {
        throw new Error(error.message ?? 'Failed to issue impersonation token');
      }

      const response = data as { token: string; expiresAt: string; auditId: string; expiresInMinutes: number } | null;

      if (!response || typeof response.token !== 'string' || typeof response.expiresAt !== 'string') {
        throw new Error('Unexpected response from impersonation service');
      }

      return response;
    },
    onSuccess: data => {
      setIssuedToken(data.token);
      setIssuedExpiresAt(data.expiresAt);
      showSuccess('Impersonation token issued successfully');
      queryClient.invalidateQueries({ queryKey: ['impersonation-audit'] });
      setReason('');
      setTargetUserId('');
      setTargetUserEmail('');
    },
    onError: error => {
      logger.error('Failed to issue impersonation token', {
        error: toError(error, 'Impersonation issuance failed'),
      });
      showError(error);
    },
  });

  const revokeMutation = useMutation<
    { revoked: boolean; auditId: string },
    Error,
    { auditId: string; silent?: boolean }
  >({
    mutationFn: async ({ auditId }) => {
      const { data, error } = await supabase.functions.invoke('super-admin-impersonate', {
        body: { action: 'revoke', auditId },
      });

      if (error) {
        throw new Error(error.message ?? 'Failed to revoke impersonation token');
      }

      const response = data as { revoked: boolean; auditId: string } | null;

      if (!response || !response.revoked) {
        throw new Error('Unexpected response when revoking impersonation token');
      }

      return response;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['impersonation-audit'] });
      if (!variables.silent) {
        showSuccess('Impersonation token revoked');
      }
    },
    onError: error => {
      logger.error('Failed to revoke impersonation token', {
        error: toError(error, 'Impersonation revoke failed'),
      });
      showError(error);
    },
  });

  useEffect(() => {
    if (!impersonationsQuery.data) {
      autoRevokedRef.current.clear();
      return;
    }

    const activeIds = new Set(impersonationsQuery.data.map(entry => entry.id));
    autoRevokedRef.current.forEach(id => {
      if (!activeIds.has(id)) {
        autoRevokedRef.current.delete(id);
      }
    });

    impersonationsQuery.data.forEach(entry => {
      if (shouldAutoRevoke(entry.expires_at, entry.revoked_at, now) && !autoRevokedRef.current.has(entry.id)) {
        autoRevokedRef.current.add(entry.id);
        revokeMutation.mutate({ auditId: entry.id, silent: true });
      }
    });
  }, [impersonationsQuery.data, now, revokeMutation]);

  if (profile?.role !== 'super_admin') {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Super Admin Impersonation</h1>
        <p className="mt-4 text-sm text-slate-600">
          You must be a super admin to issue impersonation tokens.
        </p>
      </div>
    );
  }

  const handleIssue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      validateImpersonationScope(actorOrganizationId, targetOrganizationId || null);
    } catch (error) {
      showError(error);
      return;
    }

    if (!targetUserId.trim() && !targetUserEmail.trim()) {
      showError(new Error('Provide a target user ID or email.'));
      return;
    }

    const confirmed = window.confirm('Issue a short-lived impersonation token for the selected user?');
    if (!confirmed) return;

    try {
      await issueMutation.mutateAsync();
    } catch {
      // Error surfaced via onError handler.
    }
  };

  const handleRevoke = (auditId: string) => {
    const confirmed = window.confirm('Revoke this impersonation token?');
    if (!confirmed) return;
    revokeMutation.mutate({ auditId });
  };

  const impersonations = impersonationsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold text-slate-900">Super Admin Impersonation</h1>
      <p className="mt-2 text-sm text-slate-600">
        Issue short-lived impersonation tokens for secure troubleshooting. Tokens automatically expire and are revoked within {MAX_IMPERSONATION_MINUTES} minutes.
      </p>

      <form className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleIssue}>
        <h2 className="text-xl font-semibold text-slate-900">Issue token</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="target-user-id">Target user ID</label>
            <input
              id="target-user-id"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={targetUserId}
              onChange={event => setTargetUserId(event.target.value)}
              placeholder="uuid-of-user"
            />
            <p className="mt-1 text-xs text-slate-500">Provide either the user ID or email address.</p>
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="target-user-email">Target user email</label>
            <input
              id="target-user-email"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={targetUserEmail}
              onChange={event => setTargetUserEmail(event.target.value)}
              placeholder="user@example.com"
              type="email"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="target-org">Target organization ID</label>
            <input
              id="target-org"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={targetOrganizationId}
              onChange={event => setTargetOrganizationId(event.target.value)}
              placeholder="organization uuid"
              required
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="expires-minutes">Duration (minutes)</label>
          <input
            id="expires-minutes"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            type="number"
            min={MIN_IMPERSONATION_MINUTES}
            max={MAX_IMPERSONATION_MINUTES}
            value={expiresInMinutes}
            onChange={event => {
              const nextValue = Number(event.target.value);
              setExpiresInMinutes(Number.isNaN(nextValue) ? DEFAULT_IMPERSONATION_MINUTES : nextValue);
            }}
          />
            <p className="mt-1 text-xs text-slate-500">Must be between {MIN_IMPERSONATION_MINUTES} and {MAX_IMPERSONATION_MINUTES} minutes.</p>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700" htmlFor="impersonation-reason">Reason</label>
          <textarea
            id="impersonation-reason"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={3}
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Document the justification for impersonation"
            required
          />
          <p className="mt-1 text-xs text-slate-500">This reason will be recorded in the audit trail.</p>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={issueMutation.isPending}
          >
            {issueMutation.isPending ? 'Issuing token…' : 'Issue impersonation token'}
          </button>
          <span className="text-xs text-slate-500">Token expires automatically after the configured duration.</span>
        </div>
      </form>

      {issuedToken && issuedExpiresAt && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Token issued</p>
          <p className="mt-1 break-all font-mono">{issuedToken}</p>
          <p className="mt-2 text-xs">Expires at {new Date(issuedExpiresAt).toLocaleString()}</p>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Active impersonation tokens</h2>
          <span className="text-sm text-slate-500">Auto-refreshing every 15 seconds</span>
        </div>
        {impersonationsQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500" aria-live="polite">Loading impersonation activity…</p>
        ) : impersonations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No impersonation activity recorded.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Target user</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Reason</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Issued</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Expires in</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {impersonations.map(entry => {
                  const countdown = getExpiryCountdownLabel(entry.expires_at, now);
                  const isExpired = shouldAutoRevoke(entry.expires_at, entry.revoked_at, now);
                  const statusColor = entry.revoked_at ? 'text-rose-600' : isExpired ? 'text-amber-600' : 'text-emerald-600';
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-800">{entry.target_user_id}</td>
                      <td className="max-w-xs px-4 py-2 text-sm text-slate-600">{entry.reason ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600">{new Date(entry.issued_at).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600" aria-live="polite">{countdown}</td>
                      <td className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${statusColor}`}>
                        {entry.revoked_at ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-600">
                        {entry.revoked_at ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRevoke(entry.id)}
                            className="rounded-md border border-rose-200 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                            disabled={revokeMutation.isPending}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
