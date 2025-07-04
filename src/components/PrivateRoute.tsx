import React, { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

interface PrivateRouteProps {
  children: React.ReactNode
  requiredRole?: string
  requiredRoles?: string[]
  requiredPermission?: string
}

export const PrivateRoute: React.FC<PrivateRouteProps> = ({
  children,
  requiredRole,
  requiredRoles = [],
  requiredPermission,
}) => {
  const { user, loading, initialized, hasRole, hasAnyRole, hasPermission, initialize } = useAuth()
  const location = useLocation()

  // Initialize auth on mount
  useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialized, initialize])

  // Show loading while auth is initializing
  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check role requirements
  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/unauthorized" replace />
  }

  if (requiredRoles.length > 0 && !hasAnyRole(requiredRoles)) {
    return <Navigate to="/unauthorized" replace />
  }

  // Check permission requirements
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />
  }

  // All checks passed, render the protected content
  return <>{children}</>
}

export default PrivateRoute