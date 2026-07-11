import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260711020000_expand_profiles_role_check_employee_roles.sql",
);

describe("profiles employee-role compatibility migration", () => {
  const sql = () => readFileSync(migrationPath, "utf8").toLowerCase();

  it("keeps every current role_type value valid in profiles.role", () => {
    expect(sql()).toContain("drop constraint if exists profiles_role_check");
    expect(sql()).toMatch(
      /add constraint profiles_role_check[\s\S]*role::text = any\s*\(\s*array\[[\s\S]*'client'[\s\S]*'therapist'[\s\S]*'admin'[\s\S]*'super_admin'[\s\S]*'bt'[\s\S]*'midtier'[\s\S]*'admin_schedule'[\s\S]*'bcba'/,
    );
  });

  it("replaces and validates the constraint atomically", () => {
    const migration = sql();
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.indexOf("begin;")).toBeLessThan(migration.indexOf("drop constraint"));
    expect(migration.indexOf("drop constraint")).toBeLessThan(migration.indexOf("add constraint"));
    expect(migration.indexOf("add constraint")).toBeLessThan(migration.indexOf("validate constraint"));
    expect(migration.indexOf("validate constraint")).toBeLessThan(migration.lastIndexOf("commit;"));
  });

  it("validates the replacement constraint and documents protected rollback", () => {
    expect(sql()).toContain("validate constraint profiles_role_check");
    expect(sql()).toContain("@migration-intent:");
    expect(sql()).toContain("@migration-rollback:");
  });
});
