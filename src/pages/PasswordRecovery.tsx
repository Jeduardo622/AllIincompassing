import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/authContext';
import { showSuccess } from '../lib/toast';

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
          message: 'Password recovery session is invalid or expired. Request a new reset email.',
        },
      });
    }
  }, [authLoading, isRecoverySessionValid, navigate, recoveryRedirectReady, shouldDelayInvalidRedirect]);

  if (authLoading || !isRecoverySessionValid) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!isRecoverySessionValid) {
      setError('Password recovery session is invalid or expired. Request a new reset email.');
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
        setError(updateError.message || 'Unable to update password.');
        return;
      }

      await supabase.auth.signOut();
      setSuccessMessage('Password updated. Please sign in with your new password.');
      showSuccess('Password updated successfully.');
      window.setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1200);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Unable to update password.');
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
