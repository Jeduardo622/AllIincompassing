import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrationNames = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith("_restore_client_archive_public_rpc.sql"),
);

describe("client archive public RPC migration", () => {
  it("adds one restricted public wrapper around the existing tenant-authorized function", () => {
    expect(migrationNames).toHaveLength(1);

    const migrationSql = readFileSync(
      path.join(migrationsDirectory, migrationNames[0]),
      "utf8",
    );

    expect(migrationSql).toMatch(
      /create or replace function public\.set_client_archive_state\(\s*p_client_id uuid,\s*p_restore boolean default false\s*\)/i,
    );
    expect(migrationSql).toMatch(/returns public\.clients/i);
    expect(migrationSql).toMatch(/language sql[\s\S]*security definer[\s\S]*set search_path = ''/i);
    expect(migrationSql).toContain(
      "select app.set_client_archive_state(p_client_id, p_restore);",
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.set_client_archive_state\(uuid, boolean\) from public, anon;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.set_client_archive_state\(uuid, boolean\) to authenticated;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function public\.set_client_archive_state\(uuid, boolean\)[^;]*service_role/i,
    );
    expect(migrationSql).toContain("'public.set_client_archive_state(uuid,boolean)'::regprocedure");
    expect(migrationSql).toContain(
      "has_function_privilege('anon', target_function::oid, 'EXECUTE')",
    );
    expect(migrationSql).toContain(
      "has_function_privilege('public', target_function::oid, 'EXECUTE')",
    );
    expect(migrationSql).toContain(
      "has_function_privilege('authenticated', target_function::oid, 'EXECUTE')",
    );
    expect(migrationSql).toContain("notify pgrst, 'reload schema';");
    expect(migrationSql).not.toContain("set_therapist_archive_state");
  });
});
