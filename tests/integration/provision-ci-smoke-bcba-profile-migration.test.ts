import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260713014000_provision_ci_smoke_bcba_profile.sql"),
  "utf8",
);

describe("service-only synthetic BCBA profile provisioning migration", () => {
  it("derives tenant context from authoritative role and therapist mappings", () => {
    expect(migration).toMatch(/from public\.user_roles/i);
    expect(migration).toMatch(/join auth\.users/i);
    expect(migration).toMatch(/playwright\\\.ci\\\.bcba/i);
    expect(migration).toMatch(/raw_app_meta_data ->> 'smoke_actor' = 'bcba'/i);
    expect(migration).toMatch(/raw_app_meta_data ->> 'smoke_expires_at'/i);
    expect(migration).toMatch(/r\.name = 'bcba'/i);
    expect(migration).toMatch(/join public\.user_therapist_links/i);
    expect(migration).toMatch(/join public\.therapists/i);
    expect(migration).toMatch(/count\(distinct t\.organization_id\) = 1/i);
    expect(migration).not.toMatch(/raw_user_meta_data|auth\.jwt|user_metadata/i);
  });

  it("keeps the privileged RPC service-only", () => {
    expect(migration).toMatch(/revoke execute on function public\.provision_ci_smoke_bcba_profile\(uuid\) from public/i);
    expect(migration).toMatch(/from anon/i);
    expect(migration).toMatch(/from authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.provision_ci_smoke_bcba_profile\(uuid\) to service_role/i);
  });
});
