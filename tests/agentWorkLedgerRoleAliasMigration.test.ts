import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260801090000_agent_work_ledger_core.sql"),
  "utf8",
);
const securityContract = readFileSync(
  join(process.cwd(), "scripts/agent-work-ledger-security-contract.mjs"),
  "utf8",
);

const actorManageHelper = migration.match(
  /create or replace function app\.actor_can_manage_agent_work_row[\s\S]*?\n\$\$;/i,
)?.[0] ?? "";

describe("agent work ledger manager role aliases", () => {
  it("keeps organization admin aliases equivalent inside the existing actor boundary", () => {
    expect(actorManageHelper).toContain(
      "r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin', 'bcba')",
    );
    expect(actorManageHelper).toContain("coalesce(p.is_active, true) = true");
    expect(actorManageHelper).toContain("v_actor_organization_id is distinct from p_organization_id");
    expect(actorManageHelper).toContain("coalesce(ur.is_active, true) = true");
    expect(actorManageHelper).toContain("ur.expires_at > now()");
    expect(actorManageHelper).toContain("public.agent_work_user_has_client_access");
    expect(securityContract).toContain('for (const roleName of ["org_admin", "org_super_admin"])');
    expect(securityContract).toContain("Alias manage predicate parity failed");
  });

  it("does not widen exact approval-role matching", () => {
    const exactRoleHelper = migration.match(
      /create or replace function public\.agent_work_user_has_exact_role[\s\S]*?\n\$\$;/i,
    )?.[0] ?? "";

    expect(exactRoleHelper).toContain("and role.name = btrim(p_required_role)");
    expect(exactRoleHelper).not.toContain("org_admin");
    expect(exactRoleHelper).not.toContain("org_super_admin");
  });
});
