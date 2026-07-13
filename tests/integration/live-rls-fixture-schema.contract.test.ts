import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const therapistInsertBodies = (source: string) =>
  Array.from(
    source.matchAll(
      /\.from\(["']therapists["']\)\.insert\(\{([\s\S]*?)\n\s*\}\);/g,
    ),
    (match) => match[1],
  );

describe("live RLS fixture schema contract", () => {
  it("runs hosted database validation when live RLS fixtures merge to main", () => {
    const workflow = readRepoFile(".github/workflows/supabase-validate.yml");
    const pullRequestSection = workflow.match(
      /  pull_request:\n([\s\S]*?)  push:/,
    )?.[1];
    const pushSection = workflow.match(/  push:\n([\s\S]*?)\njobs:/)?.[1];
    const testMainJob = workflow.match(
      /  test-main:\n([\s\S]*?)\n  runtime-migration-parity:/,
    )?.[1];

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(pushSection).toContain(
      "      - 'tests/integration/_helpers/liveRlsHarness.ts'",
    );
    expect(pushSection).toContain(
      "      - 'tests/integration/live-rls-fixture-schema.contract.test.ts'",
    );
    expect(pushSection).toContain("      - 'src/tests/security/rls.spec.ts'");
    expect(pushSection).toContain("      - main");
    expect(pullRequestSection).not.toContain("liveRlsHarness.ts");
    expect(pullRequestSection).not.toContain(
      "live-rls-fixture-schema.contract.test.ts",
    );
    expect(pullRequestSection).not.toContain("rls.spec.ts");
    expect(testMainJob).toContain("    if: github.event_name == 'push'");
    expect(testMainJob).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY || secrets.SUPABASE_SECRET_KEY }}",
    );
    expect(testMainJob).toContain("RUN_DB_IT: '1'");
  });

  it("seeds required therapist names in the shared live RLS harness", () => {
    const source = readRepoFile("tests/integration/_helpers/liveRlsHarness.ts");
    const inserts = therapistInsertBodies(source);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("first_name:");
    expect(inserts[0]).toContain("last_name:");
    expect(inserts[0]).toContain("${therapistId}@example.com");
    expect(source).toContain("${clientId}@example.com");
  });

  it("seeds required therapist names in every security RLS fixture", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const inserts = therapistInsertBodies(source);

    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const insert of inserts) {
      expect(insert).toContain("first_name:");
      expect(insert).toContain("last_name:");
    }
  });

  it("uses a run-unique therapist auth email when Date is frozen", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const fixtureSetup = source.match(
      /const createTenantFixture[\s\S]*?const password/,
    )?.[0];

    expect(fixtureSetup).toMatch(
      /const email = `\$\{label\}\.\$\{randomUUID\(\)\}@example\.com`/,
    );
  });

  it("uses a run-unique client auth email when Date is frozen", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");

    expect(source).toContain(
      "const clientEmail = `${label}.client.${randomUUID()}@example.com`;",
    );
  });

  it("uses run-unique admin auth emails when Date is frozen", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");

    const adminSetup = source.match(
      /const createAdminFixture[\s\S]*?const password/,
    )?.[0];
    expect(adminSetup).toMatch(
      /const email = `admin\.\$\{randomUUID\(\)\}@example\.com`/,
    );
  });
});
