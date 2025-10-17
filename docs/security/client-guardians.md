# Client Guardians Access Model

## Table Summary
- **Table**: `public.client_guardians`
- **Purpose**: Stores guardian-to-client relationships so multiple caretakers can share access to a child.
- **Key Columns**:
  - `organization_id`: Tenant scope for the relationship.
  - `client_id`: References `public.clients.id`.
  - `guardian_id`: References `auth.users.id` (the guardian’s Supabase user).
  - `relationship`: Free-form descriptor (e.g., `parent`, `grandparent`).
  - `is_primary`: Flags the primary contact for notifications.
  - `metadata`: JSON payload carrying optional names/phone details.
  - `deleted_at` / `deleted_by`: Soft-delete markers so records can be restored.

## Row Level Security
- RLS is enabled with policies that:
  - Allow org admins (and super admins) plus therapists in the same org to view and manage rows.
  - Allow a guardian to read only the rows that reference their `guardian_id`.
  - Allow a client to inspect their own guardians via `client_id = auth.uid()`.
  - Restrict inserts/updates/deletes to org admins using `app.user_has_role_for_org(...)`.

## Backfill & Roles
- Migration `20251226090000_client_guardians.sql` seeds the table from legacy `clients.parent{1,2}_*` columns when matching `auth.users` records exist.
- Any guardian inserted during the backfill receives the `client` role (if not already present) so RLS helper functions treat them as members.
- Guardians who need access going forward must have a Supabase auth account and an entry in `public.client_guardians` scoped to the child’s organization.

## Assigning Guardians
1. Create (or invite) the guardian’s Supabase auth user; ensure their metadata carries the correct organization id.
2. Insert into `public.client_guardians` with the organization, client, guardian user id, relationship, and optional metadata.
3. The helper `app.user_has_role_for_org('client', org_id, NULL, client_id)` now returns `true` for guardians tied to that client, enabling client/session policies.
4. If a guardian should lose access, soft-delete the row by setting `deleted_at` and `deleted_by`; the partial unique index prevents duplicate active links.

Refer to `docs/security/tenant-isolation.md` for broader multi-tenant enforcement expectations.
