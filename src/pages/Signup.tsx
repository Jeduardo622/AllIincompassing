import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar, Shield, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { showError, showSuccess } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'client' | 'guardian' | 'therapist' | 'admin'>('client');
  const [guardianOrganizationHint, setGuardianOrganizationHint] = useState('');
  const [guardianInviteToken, setGuardianInviteToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signUp, user } = useAuth();

  const isGuardianSignup = role === 'guardian';

  const normalizedGuardianInputs = useMemo(() => {
    const organizationHint = guardianOrganizationHint.trim();
    const inviteToken = guardianInviteToken.trim();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const normalizedOrganizationId = uuidRegex.test(organizationHint)
      ? organizationHint
      : null;

    return {
      organizationHint,
      inviteToken,
      normalizedOrganizationId,
    };
  }, [guardianOrganizationHint, guardianInviteToken]);

  useEffect(() => {
    // Redirect if user is already logged in
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!isGuardianSignup) {
      setGuardianOrganizationHint('');
      setGuardianInviteToken('');
    }
  }, [isGuardianSignup]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!email || !password || !firstName || !lastName) {
      setError('Please fill in all required fields');
      showError('Please fill in all required fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      showError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      showError('Password must be at least 8 characters long');
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      showError('Please enter a valid email address');
      return;
    }

    if (isGuardianSignup && !normalizedGuardianInputs.organizationHint && !normalizedGuardianInputs.inviteToken) {
      const guardianError =
        'Please enter either your organization ID or the invite code you received from your provider.';
      setError(guardianError);
      showError(guardianError);
      return;
    }

    try {
      setLoading(true);

      const metadata: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        signup_role: role,
        role: role === 'guardian' ? 'client' : role,
      };

      if (isGuardianSignup) {
        metadata.guardian_signup = true;

        if (normalizedGuardianInputs.organizationHint) {
          metadata.guardian_organization_hint = normalizedGuardianInputs.organizationHint;
        }

        if (normalizedGuardianInputs.inviteToken) {
          metadata.guardian_invite_token = normalizedGuardianInputs.inviteToken;
        }

        if (normalizedGuardianInputs.normalizedOrganizationId) {
          metadata.organization_id = normalizedGuardianInputs.normalizedOrganizationId;
        }
      }

      const { error } = await signUp(email, password, metadata);

      if (error) {
        const normalizedError = toError(error, 'Signup failed');

        logger.error('Signup request returned an error', {
          error: normalizedError,
          metadata: {
            role,
            attemptedEmail: email,
            guardianSignup: isGuardianSignup,
            hasGuardianOrganizationHint: Boolean(normalizedGuardianInputs.organizationHint),
            hasGuardianInviteToken: Boolean(normalizedGuardianInputs.inviteToken),
          },
        });
        setError(error.message);
        showError(error.message);
        return;
      }

      showSuccess('Account created successfully! Please check your email to confirm your account.');
      navigate('/login', { 
        state: { 
          message: 'Please check your email to confirm your account before signing in.',
          email: email 
        }
      });
    } catch (err) {
      const normalizedError = toError(err, 'Signup failed');

      logger.error('Signup request threw an exception', {
        error: normalizedError,
        metadata: {
          role,
          attemptedEmail: email,
          guardianSignup: isGuardianSignup,
          hasGuardianOrganizationHint: Boolean(normalizedGuardianInputs.organizationHint),
          hasGuardianInviteToken: Boolean(normalizedGuardianInputs.inviteToken),
        },
      });
      const message = err instanceof Error ? err.message : 'Failed to create account';
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Calendar className="h-12 w-12 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
          Create your account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          Or{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
            sign in to your existing account
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-dark-lighter py-8 px-4 shadow sm:rounded-lg sm:px-10 transition-colors">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-start" role="alert">
                <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <span className="block">{error}</span>
              </div>
            )}

            {/* Role Selection */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Account Type
              </label>
              <div className="mt-1">
                <select
                  id="role"
                  name="role"
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as 'client' | 'guardian' | 'therapist' | 'admin')
                  }
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                >
                  <option value="client">Client - Access sessions and schedule</option>
                  <option value="guardian">Guardian - Access approved dependents</option>
                  <option value="therapist">Therapist - Manage clients and sessions</option>
                  <option value="admin">Admin - Full system access</option>
                </select>
              </div>
              <div className="mt-1 flex items-center text-xs text-gray-500 dark:text-gray-400">
                <Shield className="h-3 w-3 mr-1" />
                Admin accounts require approval before activation
              </div>
            </div>

            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  First Name *
                </label>
                <div className="mt-1">
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Last Name *
                </label>
                <div className="mt-1">
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                  />
                </div>
              </div>
            </div>

            {isGuardianSignup && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="guardian-organization"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Organization ID
                  </label>
                  <div className="mt-1">
                    <input
                      id="guardian-organization"
                      name="guardian-organization"
                      type="text"
                      value={guardianOrganizationHint}
                      onChange={(event) => setGuardianOrganizationHint(event.target.value)}
                      placeholder="e.g., organization UUID or short code"
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Optional. Provide the organization identifier you received from your care team.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="guardian-invite"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Invite code
                  </label>
                  <div className="mt-1">
                    <input
                      id="guardian-invite"
                      name="guardian-invite"
                      type="text"
                      value={guardianInviteToken}
                      onChange={(event) => setGuardianInviteToken(event.target.value)}
                      placeholder="Code shared by your care team"
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Required if you do not have an organization ID. We use this to route your request for approval.
                  </p>
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  We will notify administrators in your organization. You will only see your dependents after an approval is completed.
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email address *
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password *
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Must be at least 8 characters long
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Confirm Password *
              </label>
              <div className="mt-1 relative">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-white sm:text-sm"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
              >
                {loading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Creating account...
                  </div>
                ) : (
                  'Create account'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Account Types:</h3>
            <div className="space-y-1 text-sm text-blue-700 dark:text-blue-400">
              <p><strong>Client:</strong> Book sessions, view schedules, access your records</p>
              <p><strong>Guardian:</strong> Request access to dependents and view approved updates</p>
              <p><strong>Therapist:</strong> Manage clients, create session notes, view schedules</p>
              <p><strong>Admin:</strong> Full system access, user management, reporting</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}