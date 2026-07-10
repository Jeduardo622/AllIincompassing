import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const lifecycleMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260710153231_goal_target_lifecycle_authz.sql",
  ),
  "utf8",
);

const goalTargetsMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260703173000_goal_targets_trial_events.sql",
  ),
  "utf8",
);

const capabilityInvokerMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260710161038_goal_target_delete_capability_invoker.sql",
  ),
  "utf8",
);

describe("goal target lifecycle authorization migration", () => {
  it("adds an exact BCBA delete capability and a restricted public wrapper", () => {
    expect(lifecycleMigration).toContain(
      "create or replace function app.current_user_can_delete_goal_targets(target_organization_id uuid)",
    );
    expect(lifecycleMigration).toMatch(
      /app\.current_user_can_delete_goal_targets[\s\S]*app\.current_user_has_exact_role_for_org\([\s\S]*target_organization_id[\s\S]*array\['bcba'\]::text\[\][\s\S]*\)/i,
    );
    expect(lifecycleMigration).toContain(
      "create or replace function public.current_user_can_delete_goal_targets(target_organization_id uuid)",
    );
    expect(lifecycleMigration).toContain(
      "select app.current_user_can_delete_goal_targets(target_organization_id);",
    );
    expect(lifecycleMigration).toContain(
      "grant execute on function public.current_user_can_delete_goal_targets(uuid) to authenticated, service_role;",
    );
    expect(lifecycleMigration).toContain(
      "revoke execute on function public.current_user_can_delete_goal_targets(uuid) from public, anon;",
    );
  });

  it("keeps the exposed capability wrapper invoker-scoped", () => {
    expect(capabilityInvokerMigration).toContain(
      "alter function public.current_user_can_delete_goal_targets(uuid) security invoker;",
    );
    expect(capabilityInvokerMigration).not.toMatch(
      /alter function public\.current_user_can_delete_goal_targets\(uuid\) security definer/i,
    );
    expect(capabilityInvokerMigration).toContain("notify pgrst, 'reload schema';");
  });

  it("grants authenticated DELETE while continuing to deny anonymous callers", () => {
    expect(lifecycleMigration).toContain(
      "grant delete on table public.goal_targets to authenticated;",
    );
    expect(lifecycleMigration).toContain(
      "revoke delete on table public.goal_targets from anon;",
    );
  });

  it("limits authenticated DELETE to archived unused same-org targets for exact BCBA authority", () => {
    expect(lifecycleMigration).toContain(
      "create policy goal_targets_bcba_delete_archived_unused",
    );

    const deletePolicy = lifecycleMigration.match(
      /create policy goal_targets_bcba_delete_archived_unused[\s\S]*?;/i,
    )?.[0];

    expect(deletePolicy).toBeDefined();
    expect(deletePolicy).toMatch(/on public\.goal_targets[\s\S]*for delete[\s\S]*to authenticated/i);
    expect(deletePolicy).toContain(
      "organization_id = app.current_user_organization_id()",
    );
    expect(deletePolicy).toContain(
      "app.current_user_can_delete_goal_targets(organization_id)",
    );
    expect(deletePolicy).toMatch(/status\s*=\s*'archived'/i);
    expect(deletePolicy).toMatch(
      /not exists\s*\([\s\S]*from public\.trial_events[\s\S]*target_id\s*=\s*goal_targets\.id[\s\S]*\)/i,
    );
    expect(deletePolicy).not.toContain("current_user_can_manage_programs_goals");
  });

  it("does not replace the non-cascading trial-event target foreign key", () => {
    expect(goalTargetsMigration).toMatch(
      /add constraint trial_events_target_id_fkey[\s\S]*foreign key \(target_id\) references public\.goal_targets\(id\)/i,
    );
    expect(goalTargetsMigration).not.toMatch(
      /foreign key \(target_id\) references public\.goal_targets\(id\) on delete cascade/i,
    );
    expect(lifecycleMigration).not.toContain("drop constraint if exists trial_events_target_id_fkey");
    expect(lifecycleMigration).not.toMatch(
      /foreign key \(target_id\) references public\.goal_targets\(id\) on delete cascade/i,
    );
  });
});
