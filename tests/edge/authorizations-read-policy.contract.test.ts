import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: therapist read narrowing for authorizations must stay enforced in migrations
 * (backend-first; UI is not the sole gate). Updates when policy intent changes.
 */
describe("authorizations therapist read policy (migration contract)", () => {
  it("defines caseload-scoped therapist read via app.current_user_can_read_authorization_row", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260413120000_authorizations_therapist_read_caseload.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("app.current_user_can_read_authorization_row");
    expect(sql).toContain("client_therapist_links");
    expect(sql).toContain("c.therapist_id");
    expect(sql).toContain("authorizations_org_read");
    expect(sql).toContain("authorization_services_org_read");
    expect(sql).toMatch(/user_has_role\('therapist'/);
    expect(sql).toMatch(/user_has_role\('client'/);
  });
});
