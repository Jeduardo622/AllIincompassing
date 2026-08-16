-- @migration-intent: payroll_admin_helper_authenticated_execute
-- @migration-dependencies: 20260816063149_payroll_pay_cycle_fk_indexes.sql
-- @migration-rollback: revoke execute on function app.current_user_is_payroll_admin(uuid) from authenticated;

begin;

grant execute on function app.current_user_is_payroll_admin(uuid) to authenticated;

commit;
