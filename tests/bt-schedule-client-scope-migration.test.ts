// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260810171520_restrict_bt_schedule_to_assigned_clients.sql",
);
const SMOKE_PATH = path.join(
  process.cwd(),
  "tests",
  "sql",
  "employee_role_capability_smoke.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");
const smokeSql = readFileSync(SMOKE_PATH, "utf8");

const extractFunction = (name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = sql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? "";
};

describe("BT schedule assigned-client scope migration", () => {
  it("separates org-wide reads from the existing schedule write helper", () => {
    const helper = extractFunction("app.current_user_can_read_full_schedule");

    expect(helper).toContain(
      "ARRAY['admin', 'admin_schedule', 'midtier', 'bcba']::text[]",
    );
    expect(helper).not.toContain("'therapist'");
    expect(helper).not.toContain("'bt'");
    expect(sql).not.toContain(
      "CREATE OR REPLACE FUNCTION app.current_user_can_manage_schedule",
    );
  });

  it("uses active assignments rather than historical sessions", () => {
    const assignmentHelper = extractFunction(
      "app.current_user_has_active_schedule_client",
    );
    const readHelper = extractFunction(
      "app.current_user_can_read_schedule_client",
    );

    expect(assignmentHelper).toContain("FROM public.client_therapist_links ctl");
    expect(assignmentHelper).toContain("ctl.client_id = target_client_id");
    expect(assignmentHelper).toContain("ctl.therapist_id = caller_therapist_id");
    expect(assignmentHelper).not.toContain("FROM public.sessions");
    expect(readHelper).toContain(
      "app.current_user_can_read_full_schedule(target_organization_id)",
    );
    expect(readHelper).toContain("ARRAY['bt', 'therapist']::text[]");
    expect(readHelper).toContain(
      "app.current_user_has_active_schedule_client(target_organization_id, target_client_id)",
    );
  });

  it("uses the shared predicate for direct session reads", () => {
    expect(sql).toContain("CREATE POLICY org_read_sessions");
    expect(sql).toContain(
      "app.current_user_can_read_schedule_client(organization_id, client_id)",
    );
  });

  it.each([
    ["public.get_dropdown_data", "c.id"],
    ["public.get_sessions_optimized", "s.client_id"],
    ["public.get_schedule_data_batch", "s.client_id"],
  ])("scopes %s through assigned-client authority", (name, clientExpression) => {
    const functionSql = extractFunction(name);

    expect(functionSql).toContain(
      `app.current_user_can_read_schedule_client(v_org, ${clientExpression})`,
    );
  });

  it("withholds location directory data from scoped BT and therapist users", () => {
    const dropdownSql = extractFunction("public.get_dropdown_data");

    expect(dropdownSql).toContain(
      "IF app.current_user_can_read_full_schedule(v_org) THEN",
    );
    expect(dropdownSql).toContain("IF v_org IS NULL THEN");
    expect(dropdownSql).toContain("'locations', v_locations");
  });

  it("preserves the established scheduling RPC payload fields", () => {
    const dropdownSql = extractFunction("public.get_dropdown_data");
    const optimizedSql = extractFunction("public.get_sessions_optimized");
    const batchSql = extractFunction("public.get_schedule_data_batch");

    expect(dropdownSql).toContain("'availability_hours', t.availability_hours");
    expect(dropdownSql).toContain("'availability_hours', c.availability_hours");

    for (const field of ["program_id", "goal_id", "started_at"]) {
      expect(optimizedSql).toContain(`'${field}', s.${field}`);
      expect(batchSql).toContain(`'${field}', s.${field}`);
    }

    expect(batchSql).toContain("'availability_hours', t.availability_hours");
    expect(batchSql).toContain("'availability_hours', c.availability_hours");
  });

  it("hardens helper and RPC execution grants", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION app.current_user_can_read_full_schedule(uuid) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION app.current_user_has_active_schedule_client(uuid, uuid) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION app.current_user_can_read_schedule_client(uuid, uuid) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_dropdown_data() TO authenticated;",
    );
  });

  it("documents complete rollback of the new definer helpers", () => {
    expect(sql).toContain(
      "DROP FUNCTION app.current_user_can_read_schedule_client(uuid, uuid)",
    );
    expect(sql).toContain(
      "DROP FUNCTION app.current_user_has_active_schedule_client(uuid, uuid)",
    );
    expect(sql).toContain(
      "DROP FUNCTION app.current_user_can_read_full_schedule(uuid)",
    );
  });

  it("extends the hosted smoke with positive and negative runtime probes", () => {
    expect(smokeSql).toContain("bt_schedule_assigned_client_allowed");
    expect(smokeSql).toContain("bt_schedule_unassigned_client_denied");
    expect(smokeSql).toContain("bt_schedule_cross_org_client_denied");
    expect(smokeSql).toContain("bt_schedule_historical_only_client_denied");
    expect(smokeSql).toContain("bt_schedule_rpc_client_scope");
    expect(smokeSql).toContain("therapist_schedule_rpc_client_scope");
  });
});
