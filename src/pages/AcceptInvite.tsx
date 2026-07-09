import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, Mail } from 'lucide-react';
import { callEdge, supabase } from '../lib/supabase';
import { showError, showSuccess } from '../lib/toast';

const MIN_PASSWORD_LENGTH = 8;

const getErrorMessage = async (response: Response) => {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (typeof payload?.error === 'string') {
    if (payload.error === 'invite_expired') return 'This invite has expired. Ask an administrator to send a new invite.';
    if (payload.error === 'invite_not_found') return 'This invite link is invalid or has already been used.';
    if (payload.error === 'account_creation_failed') return 'This account could not be created. It may already exist.';
    return payload.error.replace(/_/g, ' ');
  }
  return `Invite acceptance failed (${response.status}).`;
};

export function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialToken = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);
  const [token] = useState(initialToken);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedEmail, setAcceptedEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!initialToken || typeof window === 'undefined') {
      return;
    }

    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [initialToken]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      showError(new Error('Invite token is missing.'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      showError(new Error('Password must be at least 8 characters.'));
      return;
    }
    if (password !== confirmPassword) {
      showError(new Error('Passwords do not match.'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await callEdge('accept-staff-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          first_name: firstName,
          last_name: lastName,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const payload = await response.json().catch(() => null) as { email?: unknown } | null;
      const email = typeof payload?.email === 'string' ? payload.email : null;
      setAcceptedEmail(email);
      await supabase.auth.signOut();
      showSuccess('Invite accepted. Sign in with your new password.');
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (acceptedEmail) {
    return (
      <main className="min-h-dvh bg-gray-50 dark:bg-dark flex items-center justify-center px-4 py-10">
        <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-dark-lighter">
          <CheckCircle2 className="mb-4 h-10 w-10 text-emerald-600" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Invite accepted</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {acceptedEmail} can now sign in with the password you just created.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Go to login
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-dark flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-dark-lighter">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Accept Staff Invite</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">Create your password to finish staff onboarding.</p>
          </div>
        </div>

        {!token && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            Invite token is missing.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="accept-first-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                First name
              </label>
              <input
                id="accept-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
              />
            </div>
            <div>
              <label htmlFor="accept-last-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Last name
              </label>
              <input
                id="accept-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>

          <div>
            <label htmlFor="accept-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password*
            </label>
            <input
              id="accept-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="accept-confirm-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Confirm password*
            </label>
            <input
              id="accept-confirm-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <button
            type="submit"
            disabled={!token || isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <KeyRound className="h-4 w-4" />
            {isSubmitting ? 'Accepting invite...' : 'Accept invite'}
          </button>
        </form>
      </section>
    </main>
  );
}
