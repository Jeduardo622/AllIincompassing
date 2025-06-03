import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface PrivateRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export default function PrivateRoute({ children, requiredRoles }: PrivateRouteProps) {
  const { user, loading, hasRole, roles } = useAuth();
  const location = useLocation();

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
    userEmail: user?.email
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // If not logged in, redirect to login
  if (!user) {
    console.log('User not logged in, redirecting to login');
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
      return <Navigate to="/unauthorized\" replace />;
    }
  }

  return <>{children}</>;
}