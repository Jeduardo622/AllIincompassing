import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Calendar, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { showError } from '../lib/toast';
import { verifyConnection } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [connectionChecking, setConnectionChecking] = useState(true);
  const [connectionRetries, setConnectionRetries] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, user } = useAuth();

  useEffect(() => {
    // Check if user is already logged in
    if (user) {
      navigate('/', { replace: true });
      return;
    }

    // Verify Supabase connection
    const checkConnection = async () => {
      try {
        setConnectionChecking(true);
        console.log('Verifying connection to Supabase...');
        const isConnected = await verifyConnection();
        setConnectionVerified(isConnected);
        
        if (!isConnected && connectionRetries < 3) {
          // Retry connection check after a delay
          console.log(`Connection check failed, retrying (${connectionRetries + 1}/3)...`);
          setTimeout(() => {
            setConnectionRetries(prev => prev + 1);
          }, 2000);
        } else if (!isConnected) {
          console.error('Connection verification failed after retries');
          setError('Unable to connect to the server. Please check your internet connection and try again.');
        } else {
          console.log('Connection to Supabase verified successfully');
        }
      } catch (err) {
        console.error('Connection error:', err);
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } finally {
        setConnectionChecking(false);
      }
    };

    checkConnection();
  }, [user, navigate, connectionRetries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionVerified) {
      setError('Please wait for server connection to be established');
      return;
    }
    try {
      setError('');
      setLoading(true);
      console.log('Attempting to sign in...');
      await signIn(email, password);
      console.log('Sign in successful');
      
      // Get the redirect path from location state or default to home
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid email or password';
      console.error('Login error details:', err);
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryConnection = () => {
    setConnectionRetries(0);
    setError('');
    console.log('Manually retrying connection...');
  };

  if (connectionChecking) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <Calendar className="h-12 w-12 text-blue-600 animate-pulse" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Connecting to server...
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            Please wait while we establish a connection
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Calendar className="h-12 w-12 text-blue-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
          Sign in to AllIncompassing
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          Or{' '}
          <Link to="/signup" className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
            create a new account
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-dark-lighter py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {!connectionVerified && !connectionChecking && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 mr-2" />
                <span className="font-medium">Connection Error</span>
              </div>
              <p className="mt-2">Unable to connect to the server. Please check your internet connection.</p>
              <button 
                onClick={handleRetryConnection}
                className="mt-2 flex items-center px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Retry Connection
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-start" role="alert">
                <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <span className="block">{error}</span>
              </div>
            )}
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="text"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-white sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-white sm:text-sm"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || !connectionVerified}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer dark:bg-blue-700 dark:hover:bg-blue-800"
              >
                {loading ? (
                  <>
                    <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>

            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Test Account:</h3>
              <p className="text-sm text-blue-700 dark:text-blue-400">Email: test@example.com</p>
              <p className="text-sm text-blue-700 dark:text-blue-400">Password: test123</p>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">
                Note: For admin access, use j_eduardo622@yahoo.com
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}