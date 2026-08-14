import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260813013000_payroll_approval_codex_review_fixes.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

const functionDefinition = (qualifiedName: string): string =>
  sql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";

describe("payroll approval codex review fixes migration contract", () => {
  it("creates the additive review-fix migration with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_approval_codex_review_fixes/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("hardens current-state views with security barrier, security invoker, and authenticated-only select grants", () => {
    for (const viewName of [
      "timesheet_approval_current_states",
      "payroll_blocker_resolution_current_states",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `alter view public\\.${viewName}\\s+set \\(security_barrier\\s*=\\s*true,\\s*security_invoker\\s*=\\s*true\\)`,
          "i",
        ),
      );
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${viewName} from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${viewName} from service_role`, "i"));
      expect(sql).toMatch(new RegExp(`grant select on public\\.${viewName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant select on public\\.${viewName} to service_role`, "i"));
    }
  });

  it("requires both an exact active assignment and an exact active time.approve_assigned grant for manager approve and return", () => {
    const transitionDefinition = functionDefinition("public.transition_timesheet_approval");

    expect(transitionDefinition).toMatch(/security definer/i);
    expect(transitionDefinition).toMatch(/set search_path = ''/i);
    expect(transitionDefinition).toMatch(/elsif v_requested_action in \('manager_approved', 'returned'\) then/i);
    expect(transitionDefinition).toMatch(/from public\.employee_manager_assignments assignment_row/i);
    expect(transitionDefinition).toMatch(/assignment_row\.organization_id = v_actor_org/i);
    expect(transitionDefinition).toMatch(/assignment_row\.employment_profile_id = v_snapshot\.employment_profile_id/i);
    expect(transitionDefinition).toMatch(/assignment_row\.manager_user_id = auth\.uid\(\)/i);
    expect(transitionDefinition).toMatch(
      /from public\.payroll_capability_grants grant_row[\s\S]*grant_row\.organization_id = v_actor_org[\s\S]*grant_row\.user_id = auth\.uid\(\)[\s\S]*grant_row\.capability::text = 'time\.approve_assigned'[\s\S]*grant_row\.effective_from <= v_now[\s\S]*grant_row\.effective_through is null[\s\S]*grant_row\.effective_through > v_now/i,
    );
    expect(transitionDefinition).toMatch(/time\.approve_assigned capability is required/i);
  });
});
