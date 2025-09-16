# Authentication & Authorization System

## Overview

This document describes the production-ready authentication and authorization system implemented for the therapy practice management application. The system uses role-based access control (RBAC) with four distinct roles and comprehensive Row Level Security (RLS) policies.

## Architecture

### Core Components

1. **Role-Based Authentication**: Four-tier role system with hierarchical permissions
2. **Row Level Security (RLS)**: Database-level access control on all user-facing tables
3. **API Route Protection**: Middleware-based authorization for all API endpoints
4. **Comprehensive Testing**: Automated tests for all authentication flows
5. **CI Safeguards**: Automated checks to prevent security regressions

## User Roles

### Role Hierarchy

```
super_admin (Level 4) > admin (Level 3) > therapist (Level 2) > client (Level 1)
```

Higher-level roles inherit permissions from lower-level roles.

### Role Definitions

#### Client (`client`)
- **Default role** for new user registrations
- **Permissions**: 
  - View and update own profile
  - Access own session data
  - View assigned therapist information
  - Access own billing records
- **Restrictions**: Cannot access admin functions or other users' data

#### Therapist (`therapist`)
- **Permissions**:
  - All client permissions
  - View and manage assigned clients
  - Access sessions for assigned clients
  - View billing records for own sessions
- **Restrictions**: Cannot access admin functions or unassigned clients

#### Admin (`admin`)
- **Permissions**:
  - All therapist permissions
  - View and manage all users
  - Access all client and therapist data
  - Manage all sessions and billing records
  - View system reports and analytics
- **Restrictions**: Cannot change user roles or create super admin accounts

#### Super Admin (`super_admin`)
- **Permissions**:
  - All admin permissions
  - Change user roles and permissions
  - Create admin and super admin accounts
  - Access system configuration
  - Delete users and data
- **Restrictions**: Cannot demote themselves or deactivate their own account

## Database Schema

### Core Tables

#### `profiles` Table
```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  role role_type NOT NULL DEFAULT 'client',
  first_name text,
  last_name text,
  full_name text GENERATED ALWAYS AS (...) STORED,
  phone text,
  avatar_url text,
  time_zone text DEFAULT 'UTC',
  preferences jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `role_type` Enum
```sql
CREATE TYPE role_type AS ENUM ('client', 'therapist', 'admin', 'super_admin');
```

### Indexes
- `idx_profiles_email`: Fast email lookups
- `idx_profiles_role`: Role-based queries
- `idx_profiles_active`: Active user filtering
- `idx_profiles_role_active`: Combined role and active status

## Row Level Security (RLS)

### Enabled Tables
- `profiles`
- `clients`
- `therapists`
- `sessions`
- `authorizations`
- `billing_records`

### Policy Structure

#### Profiles Table
```sql
-- Users can view their own profile, admins can view all
CREATE POLICY "profiles_select" ON profiles FOR SELECT 
TO authenticated USING (
  CASE 
    WHEN auth.is_admin() THEN true
    ELSE id = auth.uid()
  END
);
```

#### Clients Table
```sql
-- Clients see self, therapists see assigned clients, admins see all
CREATE POLICY "clients_access" ON clients FOR ALL 
TO authenticated USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist') THEN EXISTS (
      SELECT 1 FROM sessions s 
      WHERE s.client_id = clients.id 
      AND s.therapist_id = auth.uid()
    )
    WHEN auth.has_role('client') THEN id = auth.uid()
    ELSE false
  END
);
```

## API Routes

### Route Matrix

| Route | Method | Allowed Roles | Description |
|-------|--------|---------------|-------------|
| `/auth/signup` | POST | Public | User registration |
| `/auth/login` | POST | Public | User authentication |
| `/profiles/me` | GET/PUT | All authenticated | User profile management |
| `/admin/users` | GET | admin, super_admin | User management |
| `/admin/users/:id/roles` | PATCH | super_admin | Role management |

### Authentication Middleware

All API routes use the `withAuth` middleware that:
1. Extracts and validates Bearer tokens
2. Fetches user profile and role information
3. Enforces role-based access control
4. Handles CORS preflight requests
5. Logs API access for security monitoring

### Example Usage

```typescript
// Public route (no authentication required)
export default createPublicRoute(async (req, userContext) => {
  // Handle public endpoint
});

// Protected route (authentication required)
export default createProtectedRoute(async (req, userContext) => {
  // Handle authenticated endpoint
}, RouteOptions.admin); // Requires admin role
```

## Security Functions

### Role Checking Functions

```sql
-- Check if user has specific role
auth.has_role(role_name role_type) -> boolean

-- Check if user has any of the specified roles
auth.has_any_role(role_names role_type[]) -> boolean

-- Get user's current role
auth.get_user_role() -> role_type

-- Check if user is admin or super_admin
auth.is_admin() -> boolean
```

### Profile Management

- **Automatic Profile Creation**: New users automatically get a profile with default 'client' role
- **Timestamp Updates**: Profile changes update the `updated_at` timestamp
- **Email Synchronization**: Profile email stays in sync with auth.users email

## Testing

### Test Coverage

#### Unit Tests
- Role checking functions
- RLS policy enforcement
- Input validation
- Error handling

#### Integration Tests
- Authentication flows
- Role-based access control
- API endpoint protection
- CORS handling

#### End-to-End Tests
- Complete user journeys for each role
- Role transitions
- Permission inheritance
- Security boundary testing

### Test Structure

```typescript
// Cypress test example
describe('Authentication & Authorization', () => {
  describe('Client Role', () => {
    it('should access own profile', () => {
      // Test client can access their own profile
    });
    
    it('should not access admin routes', () => {
      // Test client cannot access admin endpoints
    });
  });
});
```

## CI/CD Safeguards

### Database Validation

#### RLS Verification
```sql
-- Function to verify RLS is enabled on all tables
SELECT auth.verify_rls_enabled();
```

#### Schema Validation
```sql
-- Function to verify role system integrity
SELECT auth.verify_role_system();
```

### Automated Checks

1. **Pre-deployment**: Verify RLS policies are intact
2. **Schema drift detection**: Fail builds if unauthorized schema changes
3. **Permission testing**: Automated role-based access tests
4. **Security scanning**: Regular vulnerability assessments

### Build Pipeline Integration

```yaml
# Example GitHub Actions workflow
- name: Verify RLS Policies
  run: |
    supabase db diff --schema public --linked
    if [ $? -ne 0 ]; then
      echo "Schema drift detected - RLS policies may be compromised"
      exit 1
    fi
```

## Security Best Practices

### Password Requirements
- Minimum 8 characters
- Validated on both client and server
- Secure hash storage via Supabase Auth

### Session Management
- JWT tokens with expiration
- Refresh token rotation
- Secure token storage recommendations

### API Security
- Rate limiting (handled by Supabase)
- Input validation and sanitization
- CORS configuration
- Security headers

### Monitoring
- Access logging for all API endpoints
- Failed authentication tracking
- Role change auditing
- Anomaly detection

## Deployment

### Environment Variables
```bash
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> ⚠️ Supply these values through environment variables or your secret manager. Operational scripts (such as `scripts/admin-password-reset.js`) will terminate if `SUPABASE_SERVICE_ROLE_KEY` is unset or blank—no fallback key is bundled with the repository.

### Migration Application
```bash
# Apply authentication system migration
supabase db push

# Verify RLS policies
supabase db diff --schema public
```

### Post-Deployment Verification
1. Run authentication tests
2. Verify RLS policies are active
3. Test role-based access control
4. Confirm CI safeguards are working

## Troubleshooting

### Common Issues

#### RLS Policy Errors
```sql
-- Check if RLS is enabled on table
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'your_table';
```

#### Role Assignment Issues
```sql
-- Check user's current role
SELECT role FROM profiles WHERE id = 'user-id';

-- Verify role functions work
SELECT auth.has_role('admin'::role_type);
```

#### Authentication Failures
- Check token validity
- Verify user is active
- Confirm profile exists
- Check role permissions

### Debug Queries

```sql
-- View all users and their roles
SELECT email, role, is_active, created_at 
FROM profiles 
ORDER BY created_at DESC;

-- Check RLS policies on a table
SELECT * FROM pg_policies 
WHERE tablename = 'profiles';

-- Test role function
SELECT auth.get_user_role();
```

## Maintenance

### Regular Tasks
1. **Review access logs** for suspicious activity
2. **Update role assignments** as needed
3. **Monitor failed authentication attempts**
4. **Audit user permissions** quarterly
5. **Update security documentation** with changes

### Version Updates
- Test role-based access after Supabase updates
- Verify RLS policies remain intact
- Update middleware for new security features
- Maintain backward compatibility

## Support

For issues with the authentication system:
1. Check the troubleshooting section
2. Review recent schema changes
3. Verify environment variables
4. Test with known good credentials
5. Check Supabase Auth dashboard

## Changelog

### Version 1.0.0 (Current)
- Initial implementation of 4-role system
- Comprehensive RLS policies
- API route protection middleware
- Full test coverage
- CI safeguards implemented