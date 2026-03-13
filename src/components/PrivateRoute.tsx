import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';

interface PrivateRouteProps {
  children: React.ReactNode;
}

export const PrivateRoute: React.FC<PrivateRouteProps> = ({ children }) => {
  const { user, loading, profile, profileLoading, signOut } = useAuth();
  const location = useLocation();
  const inactiveSignOutRequestedRef = useRef(false);

  useEffect(() => {
    if (!user || profileLoading || profile?.is_active !== false || inactiveSignOutRequestedRef.current) {
      return;
    }
    inactiveSignOutRequestedRef.current = true;
    void signOut();
  }, [profile?.is_active, profileLoading, signOut, user]);

  // Show loading while auth is being determined
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profileLoading && profile?.is_active === false) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location, message: 'Your account is inactive. Please contact support.', messageType: 'error' }}
      />
    );
  }

  // User is authenticated, render the protected content
  return <>{children}</>;
};

