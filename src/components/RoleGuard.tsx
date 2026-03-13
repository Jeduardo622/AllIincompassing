import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';
import { logger } from '../lib/logger/logger';

interface RoleGuardProps {
  children: React.ReactNode;
  roles: ('client' | 'therapist' | 'admin' | 'super_admin')[];
  fallback?: React.ReactNode;
  requireGuardian?: boolean;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ 
  children, 
  roles, 
  fallback,
  requireGuardian = false,
}) => {
  const { user, loading, profileLoading, hasAnyRole, profile, isGuardian, signOut } = useAuth();
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
  if (loading || (user && profileLoading && !profile)) {
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

  if (requireGuardian && !isGuardian) {
    logger.warn('Guardian route access denied', {
      context: {
        route: location.pathname,
        userRole: profile?.role,
        userId: user.id,
      },
    });
    return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
  }

  // Check if user has any of the required roles
  if (!hasAnyRole(roles)) {
    logger.warn('Route access denied', {
      context: {
        route: location.pathname,
        requiredRoles: roles,
        userRole: profile?.role,
        userId: user.id,
      }
    });
    // Return custom fallback or redirect to 403 page
    return fallback ? <>{fallback}</> : <Navigate to="/unauthorized" replace />;
  }

  // User has required role, render children
  return <>{children}</>;
};

