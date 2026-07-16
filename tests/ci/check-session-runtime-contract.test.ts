import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildDatabaseSslConfig,
  evaluateStartSessionRuntimeContract,
  TABLE_GRANT_QUERY,
} from "../../scripts/ci/check-session-runtime-contract.mjs";

const validContract = {
  functionDefinition: `
create or replace function public.start_session_with_goals(...)
returns void
language plpgsql
security definer
SET search_path TO ''
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

  select not v_is_super_admin
    and coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['bt']::text[]
    ), false)
    and not coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
    ), false)
  into v_is_restricted_bt_actor;

  if v_is_restricted_bt_actor then
    if p_program_id is distinct from v_session.program_id
      or p_goal_id is distinct from v_session.goal_id
      or v_submitted_goal_ids is distinct from v_stored_goal_ids then
      return jsonb_build_object('error_code', 'PLAN_MISMATCH');
    end if;

    select count(*) from public.programs p
    where p.id = v_session.program_id and p.status = 'active';
    select count(*) from public.session_goals sg
    join public.goals g on g.id = sg.goal_id and g.status = 'active'
    join public.programs p on p.id = sg.program_id and p.status = 'active';

    update public.sessions
    set started_at = v_started_at, status = 'in_progress';
  end if;
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
  test("accepts the checked-in BT plan-lock migration function", () => {
    const migrationSql = readFileSync(
      path.join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260716162434_lock_bt_start_to_scheduled_plan.sql",
      ),
      "utf8",
    );
    const functionDefinition = migrationSql.match(
      /create or replace function public\.start_session_with_goals\([\s\S]*?\n\$\$;/i,
    )?.[0];

    expect(functionDefinition).toBeTruthy();
    expect(
      evaluateStartSessionRuntimeContract({
        ...validContract,
        functionDefinition,
      }).violations,
    ).toEqual([]);
  });

  test("requires the explicitly trusted Supabase CA without disabling certificate verification", () => {
    const ssl = buildDatabaseSslConfig("trusted-ca");

    expect(ssl).toEqual({
      ca: "trusted-ca",
      rejectUnauthorized: true,
    });
  });

  test("inspects PUBLIC ACL entries without treating PUBLIC as a database role", () => {
    expect(TABLE_GRANT_QUERY).toContain("acl.grantee = 0");
    expect(TABLE_GRANT_QUERY).not.toContain("then 'PUBLIC'");
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
      name: "SET search_path TO ''",
      before: "SET search_path TO ''",
      message: "start_session_with_goals must set an empty search_path",
    },
    {
      name: "public.current_user_is_super_admin()",
      before: "or coalesce(public.current_user_is_super_admin(), false)",
      message: "start_session_with_goals must allow public.current_user_is_super_admin()",
    },
    {
      name: "restricted exact BT plan guard",
      before: "select not v_is_super_admin",
      message: "start_session_with_goals must identify restricted exact BT actors",
    },
    {
      name: "program linkage equality",
      before: "p_program_id is distinct from v_session.program_id",
      message: "start_session_with_goals must reject BT program linkage drift",
    },
    {
      name: "primary goal linkage equality",
      before: "p_goal_id is distinct from v_session.goal_id",
      message: "start_session_with_goals must reject BT primary-goal linkage drift",
    },
    {
      name: "canonical goal-set equality",
      before: "v_submitted_goal_ids is distinct from v_stored_goal_ids",
      message: "start_session_with_goals must reject BT goal-set linkage drift",
    },
    {
      name: "active stored program validation",
      before: "from public.programs p",
      message: "start_session_with_goals must validate the stored BT program",
    },
    {
      name: "canonical session goal validation",
      before: "from public.session_goals sg",
      message: "start_session_with_goals must validate stored BT session goals",
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
