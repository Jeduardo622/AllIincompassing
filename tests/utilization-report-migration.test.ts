import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260707152000_session_cancellation_attribution.sql"),
  "utf8",
);

describe("session cancellation attribution migration", () => {
  it("adds a constrained attribution column for reporting", () => {
    expect(migrationSql).toContain("alter table public.sessions");
    expect(migrationSql).toMatch(/add column if not exists cancellation_attribution text/i);
    expect(migrationSql).toMatch(/check\s*\(\s*cancellation_attribution is null or cancellation_attribution in \('staff', 'client', 'unknown'\)\s*\)/i);
  });

  it("adds a tenant-friendly reporting index", () => {
    expect(migrationSql).toMatch(
      /create index if not exists sessions_org_client_cancel_attr_idx\s+on public\.sessions \(organization_id, client_id, status, cancellation_attribution\)/i,
    );
  });
});
