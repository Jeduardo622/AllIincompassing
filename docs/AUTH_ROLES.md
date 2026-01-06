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
- `billing_records`
- `authorizations` / `authorization_services`
- `client_guardians` / `guardian_users`
- `therapist_documents`, `therapist_certifications`, `therapist_availability`
- `session_holds`, `session_notes`, and related tenant-scoped views

Every tenant-owned table added since the guardian and therapist hardening migrations now has RLS enforced with the org-aware helpers introduced in `20251223131500_align_rls_and_grants.sql` and `20251226090000_client_guardians.sql`.

### Policy Structure

#### Org-aware helpers

- `app.user_has_role_for_org(...)` is the canonical gate. It accepts either explicit organization IDs or entity IDs (therapist, client, session) and resolves the caller’s organization/guardian context before evaluating role aliases (e.g., `org_admin`, `org_member`).【supabase/migrations/20251223131500_align_rls_and_grants.sql】【supabase/migrations/20251226090000_client_guardians.sql】
- `app.current_user_id()` and `app.current_user_organization_id()` expose authenticated request claims inside policies, ensuring every predicate is constrained to a single clinic.

#### Sessions (read/write)

```sql
CREATE POLICY org_read_sessions
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_sessions
  ON public.sessions
  FOR ALL
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  )
  WITH CHECK (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  );
```

Admins inherit full read/write access to their clinic, while therapists/clients participate via the `org_member` alias without receiving write permissions.【supabase/migrations/20251223131500_align_rls_and_grants.sql】

#### Clients & guardian access

```sql
CREATE POLICY org_read_clients
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND (
      app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'therapist'])
      OR app.user_has_role_for_org('client', organization_id, NULL, public.clients.id)
    )
  );
```

- `app.user_has_role_for_org('client', ...)` now returns `true` for the client **and** for guardians linked through `client_guardians`, giving caregivers read access without broadening their JWT scope.【supabase/migrations/20251226090000_client_guardians.sql】
- All other tenant tables (billing, authorizations, therapist resources, session holds) follow the same pattern: require `organization_id = app.current_user_organization_id()` plus one of the helper’s alias arrays, with `WITH CHECK` mirroring `USING`.

### Client Self-Service Boundaries

- Client-scoped JWTs flow through `app.user_has_role_for_org('client', organization_id, NULL, id)` to validate both identity and organization before returning rows.
- Session/billing policies pass `session_id` so the helper can resolve the underlying client before granting access.
- `WITH CHECK` clauses mirror `USING` to ensure clients, guardians, or therapists cannot write across clinics even when holding cached tokens.

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

### Role & org helpers

- `auth.get_user_roles()` – returns the caller’s role array; used by middleware such as `assertAdminOrSuperAdmin` before allowing admin routes.【supabase/migrations/20250320170909_humble_dawn.sql】【supabase/functions/_shared/auth.ts】
- `app.user_has_role_for_org(role_name text, target_org uuid, target_therapist uuid, target_client uuid, target_session uuid)` – resolves organization context (including guardianship) and enforces alias permissions (`org_admin`, `org_member`, `org_super_admin`).【supabase/migrations/20251226090000_client_guardians.sql】
- `app.user_has_role_for_org(target_user_id uuid, target_org uuid, allowed_roles text[])` – convenience wrapper used by modern RLS policies to assert org membership for admins vs members.【supabase/migrations/20251223131500_align_rls_and_grants.sql】
- `app.is_admin()` / `app.is_super_admin()` – thin wrappers around `app.has_role` used in legacy policies that still rely on boolean helpers.【supabase/migrations/20251120163000_fix_admin_and_client_policy.sql】
- `public.has_role(role text)` – public alias for `app.has_role`, kept for storage bucket policies and other non-auth schemas.【supabase/migrations/20251121123000_restore_public_role_helpers.sql】
- `app.current_user_id()` / `app.current_user_organization_id()` – expose request claims inside SQL so policies can join on the caller’s organization safely.【supabase/migrations/20251223131500_align_rls_and_grants.sql】

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

### Preventing over-posting
- Prefer allowlisted RPCs (or edge functions) for sensitive multi-field or multi-row writes (e.g., authorizations + services, document metadata updates).
- For storage-backed metadata, validate server-side that document paths are scoped to the target entity (e.g., `clients/<client_id>/...`).

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
