import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260713183443_acquire_session_hold_active_status.sql",
);

describe("acquire_session_hold BCBA authorization migration", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();

  it("adds exact persisted BCBA authorization for the target therapist organization", () => {
    expect(sql).toContain(
      "app.user_has_role_for_org('bcba', null, p_therapist_id, null, p_session_id)",
    );
  });

  it("preserves the existing therapist, admin, and super-admin checks", () => {
    expect(sql).toContain(
      "app.user_has_role_for_org('therapist', null, p_therapist_id, null, p_session_id)",
    );
    expect(sql).toContain(
      "app.user_has_role_for_org('admin', null, p_therapist_id, null, p_session_id)",
    );
    expect(sql).toContain(
      "app.user_has_role_for_org('super_admin', null, p_therapist_id, null, p_session_id)",
    );
  });

  it("keeps the privileged RPC restricted to service_role", () => {
    expect(sql).toContain(
      "revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) to service_role",
    );
  });

  it("fails closed outside the organization while preserving same-org reassignment", () => {
    expect(sql).toContain("t.organization_id into v_target_organization_id");
    expect(sql).toContain("t.deleted_at is null");
    expect(sql).toContain("c.organization_id = v_target_organization_id");
    expect(sql).toContain("c.deleted_at is null");
    const optionalSessionGuard = sql.match(
      /if p_session_id is not null[\s\S]*?and not exists \([\s\S]*?\) then/,
    )?.[0];
    expect(optionalSessionGuard).toContain(
      "s.organization_id = v_target_organization_id",
    );
    expect(optionalSessionGuard).not.toContain("s.therapist_id = p_therapist_id");
    expect(optionalSessionGuard).not.toContain("s.client_id = p_client_id");
    expect(sql.match(/'error_code', 'forbidden'/g)).toHaveLength(4);
  });

  it("requires active therapist and client rows at the hold boundary", () => {
    const therapistBoundary = sql.match(
      /select t\.organization_id into v_target_organization_id[\s\S]*?;/,
    )?.[0];
    expect(therapistBoundary).toContain("t.id = p_therapist_id");
    expect(therapistBoundary).toContain("t.status = 'active'");
    expect(therapistBoundary).toContain("t.deleted_at is null");

    const clientBoundary = sql.match(
      /if v_target_organization_id is null[\s\S]*?or not exists \([\s\S]*?from clients c[\s\S]*?\) then/,
    )?.[0];
    expect(clientBoundary).toContain("c.id = p_client_id");
    expect(clientBoundary).toContain(
      "c.organization_id = v_target_organization_id",
    );
    expect(clientBoundary).toContain("c.status = 'active'");
    expect(clientBoundary).toContain("c.deleted_at is null");
  });
});
