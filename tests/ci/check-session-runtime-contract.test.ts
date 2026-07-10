import { describe, expect, test } from "vitest";

import { evaluateStartSessionRuntimeContract } from "../../scripts/ci/check-session-runtime-contract.mjs";

const validContract = {
  functionDefinition: `
create or replace function public.start_session_with_goals(...)
begin
  select coalesce(app.current_user_has_exact_role_for_org(
    v_session.organization_id,
    array['admin', 'admin_schedule', 'midtier', 'bcba']::text[]
  ), false)
  into v_has_start_authority;

  select coalesce(app.current_user_has_exact_role_for_org(
    v_session.organization_id,
    array['therapist', 'bt']::text[]
  ), false)
  and exists (
    select 1
    from public.user_therapist_links utl
    join public.therapists t on t.id = utl.therapist_id
    where utl.user_id = v_actor_id
      and utl.therapist_id = v_session.therapist_id
      and t.organization_id = v_session.organization_id
      and t.deleted_at is null
  )
  into v_has_start_authority;
end;
`,
  executeGrants: {
    anon: false,
    authenticated: true,
    service_role: true,
  },
  tableGrants: {
    goal_domains: {
      anon: [],
      authenticated: ["INSERT", "SELECT", "UPDATE"],
      service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    },
    user_therapist_links: {
      anon: [],
      authenticated: ["SELECT"],
      service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    },
  },
};

describe("check-session-runtime-contract", () => {
  test("accepts the live function and grant contract when all required clauses are present", () => {
    const result = evaluateStartSessionRuntimeContract(validContract);

    expect(result.violations).toEqual([]);
  });

  test("rejects missing same-org active therapist link authorization clauses", () => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      functionDefinition: validContract.functionDefinition.replace("and t.deleted_at is null", ""),
    });

    expect(result.violations).toContain(
      "start_session_with_goals must require a same-org active therapist join through public.user_therapist_links",
    );
  });

  test("rejects execute grants when anon can call the function", () => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      executeGrants: {
        ...validContract.executeGrants,
        anon: true,
      },
    });

    expect(result.violations).toContain("start_session_with_goals EXECUTE must be denied to anon");
  });

  test("rejects goal_domains and user_therapist_links grants that drift from the hardening migration", () => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      tableGrants: {
        ...validContract.tableGrants,
        goal_domains: {
          anon: [],
          authenticated: ["DELETE", "INSERT", "SELECT", "UPDATE"],
          service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        },
      },
    });

    expect(result.violations).toContain(
      "goal_domains grants must match the checked-in hardening migration for authenticated and service_role",
    );
  });
});
