-- @migration-intent: WIN-35 throughput wave — gamma: five unused-index drops (user_therapist_links, client_session_notes, edi_claim_statuses); disjoint from alpha/beta; MCP advisor 2026-04-17.
-- @migration-dependencies: 20260417110000_unused_index_drop_throughput_beta_win35.sql
-- @migration-rollback: Recreate dropped btree indexes if linkage, notes, or EDI lookups regress.

begin;

set search_path = public;

drop index if exists public.user_therapist_links_user_id_idx;
drop index if exists public.client_session_notes_authorization_id_idx;
drop index if exists public.client_session_notes_session_date_idx;
drop index if exists public.client_session_notes_created_by_idx;
drop index if exists public.edi_claim_statuses_billing_record_idx;

commit;
