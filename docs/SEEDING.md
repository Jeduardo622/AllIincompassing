# Database Seeding Guide

The preview pipeline and local `supabase db reset` runs depend on `supabase/seed.sql` to hydrate a minimal, development-safe dataset. Keeping these seeds up to date ensures migrations can be applied automatically in CI/CD without manual dashboard setup.

## Seed contents

Running the seed script produces:

- **Baseline roles** – `super_admin`, `admin`, `therapist`, `client`, `receptionist`, and `monitoring` with deterministic permission payloads.
- **Preview accounts** – four confirmed users with predictable credentials:

  | Role | Email | Password |
  | ---- | ----- | -------- |
  | Client | `client@test.com` | `password123` |
  | Therapist | `therapist@test.com` | `password123` |
  | Admin | `admin@test.com` | `password123` |
  | Super Admin | `superadmin@test.com` | `password123` |

  > Passwords are hashed inside the SQL using `crypt(..., gen_salt('bf'))`; plain strings never persist in the database.

- **Domain fixtures** – linked `profiles`, `user_roles`, therapist/client records (including availability and insurance metadata), and a sample scheduled session joining the therapist/client pair.

## Expected workflow

1. Apply migrations and seeds together:
   ```bash
   supabase db reset --force --project-ref wnnjeqheqxxyrgsjmygy
   ```
2. Log in locally or in the Netlify preview using the credentials above to verify end-to-end flows.
3. When migrations introduce new required lookup data (roles, enums, status codes, etc.), extend `supabase/seed.sql` so `db reset` remains idempotent.
4. Keep fixtures generic—no production data, PHI, or secrets should appear in the seed file.

## Contribution checklist

- [ ] Update `supabase/seed.sql` whenever migrations add mandatory reference data.
- [ ] Re-run `supabase db reset --force` locally to ensure migrations + seeds apply cleanly.
- [ ] Validate front-end smoke flows with the seeded credentials (login, schedule overview, etc.).
- [ ] Mention any seed changes in PR summaries so reviewers know to refresh their local databases.
