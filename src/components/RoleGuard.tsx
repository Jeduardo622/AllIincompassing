import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';
import { logger } from '../lib/logger/logger';

interface RoleGuardProps {
  children: React.ReactNode;
  roles: ('client' | 'therapist' | 'admin' | 'super_admin')[];
  fallback?: React.ReactNode;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ 
  children, 
  roles, 
  fallback 
}) => {
  const { user, loading, hasAnyRole, profile } = useAuth();
  const location = useLocation();

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
    return <Navigate to="/login" replace />;
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

export default RoleGuard;