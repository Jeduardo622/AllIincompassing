### Migration Plan (Non-Prod)

Migrations to apply:

1) 20250924120000_add_cpt_and_modifiers.sql
- Adds CPT code format check (#####) to `cpt_codes`.
- Adds unique (entry, position) to `session_cpt_modifiers`.
- Adds helpful indexes for modifiers.
- RLS impact: none (metadata and constraint/index only).
- Rollback: drop added constraint and indexes.

2) 20250924121000_rpc_insert_session_with_billing.sql
- Creates `insert_session_with_billing(p_session jsonb, p_cpt_code text, p_modifiers text[], p_session_id uuid)`.
- SECURITY DEFINER with org/role checks; grants execute to authenticated only.
- Writes to `sessions`, `session_cpt_entries`, `session_cpt_modifiers`.
- RLS impact: function bypasses table RLS by definer; explicit org/role checks mitigate.
- Rollback: drop function and revoke grants.

Application
- Use `supabase db push` against non-prod project. Ensure `SUPABASE_ACCESS_TOKEN` set.

Risk Notes
- Ensure CPT code format matches existing rows; if any non-##### rows exist, fix before apply.
- Function security: verify app.user_has_role_for_org semantics in your project.


