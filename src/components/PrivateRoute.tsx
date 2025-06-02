import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useEffect, useState } from 'react';

interface PrivateRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export default function PrivateRoute({ children, requiredRoles }: PrivateRouteProps) {
  const { user, loading, hasRole, roles, refreshSession } = useAuth();
  const location = useLocation();
  const [authTimeout, setAuthTimeout] = useState(false);

  // Set a timeout for loading state to prevent infinite loading
  useEffect(() => {
    let timeoutId: number | undefined;
    
    if (loading) {
      timeoutId = window.setTimeout(() => {
        console.warn('Authentication loading timed out after 20 seconds');
        setAuthTimeout(true);
      }, 20000); // Increased from 10000 to 20000 (20 seconds)
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [loading]);

  // If loading times out, try to refresh the session once
  useEffect(() => {
    if (authTimeout) {
      console.log('Auth timeout detected, attempting to refresh session');
      refreshSession().catch(error => {
        console.error('Error refreshing session after timeout:', error);
      });
    }
  }, [authTimeout, refreshSession]);

  // Add logging to help debug role issues
  console.log('PrivateRoute check:', {
    path: location.pathname,
    isLoading: loading,
    isLoggedIn: !!user,
    userRoles: roles,
    requiredRoles,
    hasRequiredRoles: requiredRoles ? requiredRoles.map(role => ({ 
      role, 
      hasRole: hasRole(role) 
    })) : 'No roles required',
    userEmail: user?.email,
    authTimeout
  });

  // If loading and not timed out yet, show loading spinner
  if (loading && !authTimeout) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // If not logged in or auth timed out, redirect to login
  if (!user || authTimeout) {
    console.log('User not logged in or auth timed out, redirecting to login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If roles are required, check if user has at least one of them
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = requiredRoles.some(role => hasRole(role));
    console.log('Role check result:', { 
      hasRequiredRole, 
      userRoles: roles, 
      requiredRoles,
      individualChecks: requiredRoles.map(role => ({
        role,
        hasRole: hasRole(role),
        isAdmin: roles.includes('admin')
      }))
    });
    
    if (!hasRequiredRole) {
      console.log('User lacks required role, redirecting to unauthorized');
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <>{children}</>;
}