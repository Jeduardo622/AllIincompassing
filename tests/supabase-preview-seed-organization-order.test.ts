import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SEED_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const LEGACY_FALLBACK_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";

const seedSql = readFileSync(path.resolve("supabase/seed.sql"), "utf8");

describe("Supabase preview seed organization ordering", () => {
  it("schema-qualifies pgcrypto password hashing for clean local databases", () => {
    expect(seedSql.match(/extensions\.crypt\(/g)).toHaveLength(2);
    expect(seedSql.match(/extensions\.gen_salt\('bf'\)/g)).toHaveLength(2);
    expect(seedSql).not.toMatch(/(?<!extensions\.)crypt\(/);
    expect(seedSql).not.toMatch(/(?<!extensions\.)gen_salt\(/);
  });

  it("creates the deterministic organization before auth inserts", () => {
    const organizationInsertIndex = seedSql.indexOf("INSERT INTO public.organizations");
    const authInsertIndex = seedSql.indexOf("INSERT INTO auth.users");

    expect(organizationInsertIndex).toBeGreaterThan(-1);
    expect(authInsertIndex).toBeGreaterThan(-1);
    expect(organizationInsertIndex).toBeLessThan(authInsertIndex);
    expect(seedSql.match(/INSERT INTO public\.organizations/g)).toHaveLength(1);

    const organizationInsert = seedSql.slice(
      organizationInsertIndex,
      seedSql.indexOf(";", organizationInsertIndex) + 1,
    );
    expect(organizationInsert).toContain(`'${SEED_ORGANIZATION_ID}'::uuid`);
    expect(organizationInsert).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("binds every seeded auth user to the deterministic organization", () => {
    const metadataStartIndex = seedSql.indexOf("metadata := jsonb_build_object(");
    const authInsertIndex = seedSql.indexOf("INSERT INTO auth.users");
    const metadataBlock = seedSql.slice(metadataStartIndex, authInsertIndex);

    expect(metadataStartIndex).toBeGreaterThan(-1);
    expect(metadataBlock).toContain(
      `'organization_id', '${SEED_ORGANIZATION_ID}'`,
    );
    expect(metadataBlock).toContain(
      `'organizationId', '${SEED_ORGANIZATION_ID}'`,
    );
    expect(seedSql).not.toContain(LEGACY_FALLBACK_ORGANIZATION_ID);
  });
});
