import { describe, expect, test } from "vitest";

import {
  buildDatabaseSslConfig,
  evaluateStartSessionRuntimeContract,
} from "../../scripts/ci/check-session-runtime-contract.mjs";

const validContract = {
  functionDefinition: `
create or replace function public.start_session_with_goals(...)
returns void
language plpgsql
security definer
SET search_path TO 'public'
begin
  select coalesce(app.current_user_has_exact_role_for_org(
    v_session.organization_id,
    array['admin', 'admin_schedule', 'midtier', 'bcba']::text[]
  ), false)
  or coalesce(public.current_user_is_super_admin(), false)
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
      and v_session.therapist_id = v_actor_id
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
      public: [],
      anon: [],
      authenticated: ["INSERT", "SELECT", "UPDATE"],
      service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    },
    user_therapist_links: {
      public: [],
      anon: [],
      authenticated: ["SELECT"],
      service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    },
  },
};

describe("check-session-runtime-contract", () => {
  test("requires the explicitly trusted Supabase CA without disabling certificate verification", () => {
    const ssl = buildDatabaseSslConfig("trusted-ca");

    expect(ssl).toEqual({
      ca: "trusted-ca",
      rejectUnauthorized: true,
    });
  });

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

  test.each([
    {
      name: "utl.user_id = v_actor_id",
      before: "where utl.user_id = v_actor_id",
      message: "start_session_with_goals must scope user_therapist_links to v_actor_id",
    },
    {
      name: "utl.therapist_id = v_session.therapist_id",
      before: "and utl.therapist_id = v_session.therapist_id",
      message: "start_session_with_goals must scope user_therapist_links to v_session.therapist_id",
    },
    {
      name: "v_session.therapist_id = v_actor_id",
      before: "and v_session.therapist_id = v_actor_id",
      message: "start_session_with_goals must require therapist actors to match v_session.therapist_id",
    },
    {
      name: "security definer",
      before: "security definer",
      message: "start_session_with_goals must be SECURITY DEFINER",
    },
    {
      name: "SET search_path TO 'public'",
      before: "SET search_path TO 'public'",
      message: "start_session_with_goals must set search_path = public",
    },
    {
      name: "public.current_user_is_super_admin()",
      before: "or coalesce(public.current_user_is_super_admin(), false)",
      message: "start_session_with_goals must allow public.current_user_is_super_admin()",
    },
  ])("rejects missing runtime marker: $name", ({ before, message }) => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      functionDefinition: validContract.functionDefinition.replace(before, ""),
    });

    expect(result.violations).toContain(message);
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
          public: [],
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

  test("rejects PUBLIC grants on protected runtime ACL tables", () => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      tableGrants: {
        ...validContract.tableGrants,
        user_therapist_links: {
          public: ["SELECT"],
          anon: [],
          authenticated: ["SELECT"],
          service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        },
      },
    });

    expect(result.violations).toContain(
      "user_therapist_links grants must match the checked-in hardening migration for authenticated and service_role",
    );
  });

  test("rejects comment-only marker spoofing in the function body", () => {
    const result = evaluateStartSessionRuntimeContract({
      ...validContract,
      functionDefinition: `
create or replace function public.start_session_with_goals(...)
returns void
language plpgsql
security definer
set search_path = public
begin
  /* public.current_user_is_super_admin() */
  -- app.current_user_has_exact_role_for_org(
  perform 1;
end;
`,
    });

    expect(result.violations).toContain(
      "start_session_with_goals must call app.current_user_has_exact_role_for_org",
    );
    expect(result.violations).toContain(
      "start_session_with_goals must allow public.current_user_is_super_admin()",
    );
  });
});
