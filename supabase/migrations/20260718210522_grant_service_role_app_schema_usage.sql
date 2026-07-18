-- @migration-intent: Let the service role execute the exact synthetic-proof cleanup helper in the non-public app schema.
-- @migration-dependencies: 20260718204735_allow_exact_bt_proof_history_cleanup.sql
-- @migration-rollback: Revoke usage on schema app from service_role after confirming no other service-role app-schema callers depend on it.

begin;

-- Function EXECUTE alone is insufficient for a caller to resolve a function
-- in a non-public schema. Object-level grants remain independently enforced.
grant usage on schema app to service_role;

commit;
