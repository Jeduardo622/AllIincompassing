### Supabase Diagnostic

#### Inventory & Environment
- Framework: Vite + React + TypeScript. Supabase client in `src/lib/supabaseClient.ts` via anon key (browser), server utilities use service role only on server (`src/server/sessionCptPersistence.ts`).
- CLI: npx supabase@latest version = 2.45.5.
- Env files present: `.env`, `.env.codex` (contain dev anon key); added `.env.example` with placeholders.

#### Schema highlights (selected)
- PHI/PII tables with RLS ON: `clients`, `therapists`, `sessions`, `billing_records`, `session_transcripts`, `session_transcript_segments`, `user_profiles`, `profiles`, etc. CPT data model present: `cpt_codes`, `billing_modifiers`, `cpt_modifier_mappings`, `session_cpt_entries`, `session_cpt_modifiers`.
- Organization scoping: migration `supabase/migrations/20250923121500_enforce_org_scope.sql` adds `organization_id` columns and org-aware triggers and policies.

#### RLS Coverage (evidence excerpts)
- `clients`: policies require org-scoped access; therapists must be related via sessions.
- `sessions`: org-scoped access; therapists can access their own, admins all.
- `billing_records`: org-scoped; therapist allowed when owning session.
- `session_cpt_entries`: org-scoped select/insert/update/delete; service_role allowed for admin tooling.
- `session_holds`: disallow by default; explicit authenticated policies for therapist/admin insert/select/update/delete; Edge RPCs mutate via security definer functions.
- `cpt_codes`, `billing_modifiers`, `cpt_modifier_mappings`: RLS enabled; SELECT for authenticated, ALL for service_role.

Gaps/Risks
- Some tables (e.g., performance/logging tables) permit broader access to authenticated; verify no PHI there. Session transcript policies limit by therapist/session; confirm no client PHI leakage via indirect joins.
- Confirm that JWT includes org claim for app.user_has_role_for_org() resolution; otherwise org inference relies on relationships.

#### RPCs/Functions (booking/billing)
- Edge functions: `sessions-hold`, `sessions-confirm`, `sessions-cancel` calling SQL `acquire_session_hold`, `confirm_session_hold` (security definer) [supabase/functions/*, migrations 20250711090000_session_holds.sql].
- `confirm_session_hold` rounds duration to 15-min increments; UI derives CPT separately then persists via server using service role.
- CPT/modifiers: tables exist; `session_cpt_entries` + `session_cpt_modifiers` managed by `src/server/sessionCptPersistence.ts` (server-only, service role).

Booking/Billing CPT presence
- `sessions` table: does NOT have direct cpt columns; CPT is persisted into `session_cpt_entries` with modifiers linkage.
- UI derives CPT in `src/server/deriveCpt.ts` from session_type/location/overrides; then `persistSessionCptMetadata` writes code + modifiers.

Secrets usage
- No service role in client bundle. Browser client only uses anon (`src/lib/supabaseClient.ts`). Server code gates service role in `src/server/*` using `getRequiredServerEnv`.

Connectivity & headers
- Management: Use PAT `SUPABASE_ACCESS_TOKEN` for CLI only.
- REST/RPC: apikey: anon + Authorization: Bearer <user JWT>. UI: `callEdge` attaches Bearer; anon key is not injected on REST paths (OK, Supabase-js sets it as apikey internally).

Timelines
- RLS audit hardening: 🟧 needs review of broad admin/perf tables (S: 3–5 days).
- Booking/CPT path complete; propose adding insert RPC if serverless path is preferred over service-role insert (S: 2–3 days).


