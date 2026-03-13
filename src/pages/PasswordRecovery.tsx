import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/authContext';
import { showSuccess } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';

const INVALID_RECOVERY_MESSAGE = 'Password recovery session is invalid or expired. Request a new reset email.';

const mapPasswordRecoveryErrorToUserMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  const normalizedMessage = rawMessage.trim().toLowerCase();

  if (normalizedMessage.includes('password')) {
    return 'Unable to update your password. Please review the requirements and try again.';
  }

  if (normalizedMessage.includes('too many requests') || normalizedMessage.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  if (normalizedMessage.includes('network') || normalizedMessage.includes('fetch')) {
    return 'Unable to update your password right now. Check your connection and try again.';
  }

  return 'Unable to update your password right now. Please try again in a moment.';
};

export function PasswordRecovery() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authFlow, user, loading: authLoading } = useAuth();
  const isRecoverySessionValid = Boolean(user) && authFlow === 'password_recovery';
  const [recoveryRedirectReady, setRecoveryRedirectReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const recoveryCallbackDetected = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const callbackType = (searchParams.get('type') ?? hashParams.get('type') ?? '').toLowerCase();
    const hasToken = Boolean(
      searchParams.get('access_token') ||
      searchParams.get('refresh_token') ||
      hashParams.get('access_token') ||
      hashParams.get('refresh_token')
    );
    return callbackType === 'recovery' || hasToken;
  }, [location.hash, location.search]);

  useEffect(() => {
    if (!recoveryCallbackDetected) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const sensitiveKeys = ['access_token', 'refresh_token', 'token', 'type', 'expires_in', 'expires_at'];
    let shouldReplaceUrl = false;

    for (const key of sensitiveKeys) {
      if (searchParams.has(key)) {
        shouldReplaceUrl = true;
        searchParams.delete(key);
      }
      if (hashParams.has(key)) {
        shouldReplaceUrl = true;
        hashParams.delete(key);
      }
    }

    if (!shouldReplaceUrl) {
      return;
    }

    const nextSearch = searchParams.toString();
    const nextHash = hashParams.toString();
    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState(window.history.state, document.title, nextUrl);
  }, [location.hash, location.pathname, location.search, recoveryCallbackDetected]);

  const shouldDelayInvalidRedirect = recoveryCallbackDetected && !isRecoverySessionValid;

  useEffect(() => {
    if (!shouldDelayInvalidRedirect) {
      setRecoveryRedirectReady(true);
      return;
    }

    setRecoveryRedirectReady(false);
    const timerId = window.setTimeout(() => {
      setRecoveryRedirectReady(true);
    }, 1500);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [shouldDelayInvalidRedirect]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (shouldDelayInvalidRedirect && !recoveryRedirectReady) {
      return;
    }
    if (!isRecoverySessionValid) {
      navigate('/login', {
        replace: true,
        state: {
          message: INVALID_RECOVERY_MESSAGE,
          messageType: 'error',
        },
      });
    }
  }, [authLoading, isRecoverySessionValid, navigate, recoveryRedirectReady, shouldDelayInvalidRedirect]);

  if (authLoading || !isRecoverySessionValid) {
    const isValidatingLink = shouldDelayInvalidRedirect && !recoveryRedirectReady;
    const title = isValidatingLink ? 'Validating reset link' : 'Reset link expired';
    const description = isValidatingLink
      ? 'We are verifying your password reset session now.'
      : 'This password reset link is invalid or has expired. Please request a new one.';

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white dark:bg-dark-lighter py-8 px-4 shadow sm:rounded-lg sm:px-10 transition-colors text-center space-y-4">
            <div className="flex justify-center" aria-hidden="true">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
            <div className="flex flex-col gap-2 pt-2">
              <Link
                to="/login"
                className="inline-flex justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
              >
                Go to login
              </Link>
              <Link
                to="/login"
                state={{ message: INVALID_RECOVERY_MESSAGE, messageType: 'error' }}
                className="inline-flex justify-center rounded-md border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/20 transition-colors"
              >
                Request a new reset email
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!isRecoverySessionValid) {
      setError(INVALID_RECOVERY_MESSAGE);
      return;
    }

    if (!password || !confirmPassword) {
      setError('Please provide and confirm your new password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        logger.error('Password update returned an error', {
          error: toError(updateError, 'Password update failed'),
          metadata: {
            flow: 'passwordRecovery',
          },
        });
        setError(mapPasswordRecoveryErrorToUserMessage(updateError));
        return;
      }

      await supabase.auth.signOut();
      setSuccessMessage('Password updated. Please sign in with your new password.');
      showSuccess('Password updated successfully.');
      window.setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1200);
    } catch (exception) {
      logger.error('Password update threw an exception', {
        error: toError(exception, 'Password update failed'),
        metadata: {
          flow: 'passwordRecovery',
        },
      });
      setError(mapPasswordRecoveryErrorToUserMessage(exception));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
          Set a new password
        </h2>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-dark-lighter py-8 px-4 shadow sm:rounded-lg sm:px-10 transition-colors">
          <form onSubmit={handleSubmit} className="space-y-6">
            {successMessage && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg flex items-start" role="alert">
                <CheckCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-start" role="alert">
                <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
            >
              {loading ? 'Updating...' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
