// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20251231150000_lock_down_scheduling_rpcs.sql",
);

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

describe("scheduling RPC hardening migration", () => {
  it("exists and revokes PUBLIC/anon execute on scheduling RPCs", () => {
    const sql = readMigration();

    // High-risk RPCs must not be executable by PUBLIC/anon.
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM anon;",
    );
  });

  it("grants read-only scheduling RPCs only to authenticated", () => {
    const sql = readMigration();

    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_dropdown_data() TO authenticated;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_session_metrics(date, date, uuid, uuid) TO authenticated;",
    );
  });

  it("locks down confirm_session_hold to service_role only and disables the legacy overload", () => {
    const sql = readMigration();

    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM anon;",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM authenticated;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) TO service_role;",
    );

    // Ensure the unsafe overload isn't callable from API roles (including service_role).
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb, uuid) FROM service_role;",
    );
  });

  it("makes schedule data RPCs fail-closed on missing org context", () => {
    const sql = readMigration();

    // Fail-closed checks should exist (avoid v_org IS NULL OR ... patterns).
    expect(sql).toMatch(/v_org uuid := app\.current_user_organization_id\(\);/);
    expect(sql).toMatch(/IF v_org IS NULL THEN[\s\S]*RETURN/);

    // Guard against the previous fail-open pattern.
    expect(sql).not.toContain("(v_org IS NULL OR");
  });
});

