import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { organizationMetadataSchema } from "../../src/lib/featureFlags/organizationMetadataSchema";

describe("organization metadata schema", () => {
  it("accepts valid structured metadata", () => {
    const metadata = {
      billing: {
        contact: {
          name: "Alicia Ops",
          email: "alicia.ops@example.com",
          phone: "+1 (555) 000-2222",
        },
        cycle: "annual",
        poNumber: "PO-8821",
      },
      seats: {
        licensed: 120,
        active: 95,
      },
      rollout: {
        cohort: "beta-2025-q1",
        startAt: new Date("2025-01-15T12:00:00Z").toISOString(),
        flags: ["beta-dashboard", "automation-suite"],
      },
      tags: ["beta", "priority"],
      notes: "Key account with contractual automation add-on.",
    } as const;

    const parsed = organizationMetadataSchema.parse(metadata);

    expect(parsed.rollout?.flags?.length).toBe(2);
    expect(parsed.billing?.contact?.name).toBe("Alicia Ops");
    expect(parsed.seats?.active).toBe(95);
  });

  it("rejects invalid seat allocations", () => {
    expect(() =>
      organizationMetadataSchema.parse({
        seats: {
          licensed: 5,
          active: 9,
        },
      }),
    ).toThrowError(/Active seats cannot exceed licensed seats/);
  });
});

describe("feature flag plan history migration", () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationPath = resolve(
    currentDir,
    "..",
    "..",
    "supabase",
    "migrations",
    "20251222113000_feature_flag_plan_history.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf8");

  it("creates the immutable history table", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.feature_flag_plan_history");
    expect(migrationSql).toContain("feature_flag_plan_history_prevent_update");
    expect(migrationSql).toContain("feature_flag_plan_history_prevent_delete");
  });

  it("adds triggers for plan and flag transitions", () => {
    expect(migrationSql).toMatch(/organization_feature_flags_history_aiud/i);
    expect(migrationSql).toMatch(/organization_plans_history_aiud/i);
    expect(migrationSql).toContain("log_organization_flag_history");
    expect(migrationSql).toContain("log_organization_plan_history");
  });
});
