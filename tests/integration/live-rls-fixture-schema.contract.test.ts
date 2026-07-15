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

const assignTherapistRoleBodies = (source: string) =>
  Array.from(
    source.matchAll(
      /\.rpc\(["']assign_therapist_role["'],\s*\{([\s\S]*?)\n\s*\}\)/g,
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
      "      - '.github/workflows/supabase-validate.yml'",
    );
    expect(pushSection).toContain(
      "      - 'tests/integration/_helpers/liveRlsHarness.ts'",
    );
    expect(pushSection).toContain(
      "      - 'tests/integration/live-rls-fixture-schema.contract.test.ts'",
    );
    expect(pushSection).toContain(
      "      - 'tests/integration/liveRlsHarness.unit.test.ts'",
    );
    expect(pushSection).toContain(
      "      - 'src/tests/security/ciRlsFixtureMetadata.ts'",
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

  it("uses the Node transport only for explicitly trusted database integration runs", () => {
    const config = readRepoFile("vitest.config.ts");
    const securitySuite = readRepoFile("src/tests/security/rls.spec.ts");

    expect(config).toContain("const runTrustedDatabaseIntegrationTests = ['1', 'true'].includes(");
    expect(config).toContain(
      "const liveRlsEnvironment = runTrustedDatabaseIntegrationTests ? 'node' : 'jsdom';",
    );
    expect(config).toContain("['src/tests/security/rls.spec.ts', liveRlsEnvironment]");
    expect(config).toContain("['tests/integration/rls.*.test.ts', liveRlsEnvironment]");
    expect(securitySuite).toContain(
      "const SHOULD_RUN_RLS_TESTS = environmentResolution.shouldRun && runDatabaseIntegrationTests;",
    );
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

  it("creates and removes organization rows around shared live RLS data", () => {
    const source = readRepoFile("tests/integration/_helpers/liveRlsHarness.ts");
    const organizationInsert = source.indexOf('.from("organizations").insert(');
    const firstAuthFixture = source.indexOf(
      "const orgAAdmin = await createTrackedAuthFixture",
    );

    expect(organizationInsert).toBeGreaterThan(-1);
    expect(organizationInsert).toBeLessThan(firstAuthFixture);
    expect(source).toContain(
      '.from("organizations").delete().in("id", [orgAId, orgBId])',
    );
    expect(source).toContain("await cleanupCreatedResources();");
    expect(source).toContain("throw new AggregateError(cleanupErrors");
    expect(source).toContain(
      '.from("admin_actions").delete().in("organization_id", organizationIds)',
    );
  });

  it("creates and removes organization rows around the security RLS fixtures", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const organizationInsert = source.indexOf(".from('organizations')\n    .insert([");
    const firstTenantFixture = source.indexOf(
      "orgAContext = await createTenantFixture('orga', orgAId)",
    );

    expect(organizationInsert).toBeGreaterThan(-1);
    expect(organizationInsert).toBeLessThan(firstTenantFixture);
    expect(source).toContain("slug: `security-rls-org-a-${orgAId}`");
    expect(source).toContain("slug: `security-rls-org-b-${orgBId}`");
    expect(source).toContain(
      ".from('organizations').delete().in('id', [orgAId, orgBId])",
    );
    expect(source).toMatch(
      /\.from\('admin_actions'\)\s*\.delete\(\)\s*\.in\('organization_id', \[orgAId, orgBId\]\)/,
    );
    expect(source.match(/createdFixtureAuthUserIds\.push\(/g)).toHaveLength(3);
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

  it("calls the current one-argument therapist role RPC in security fixtures", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const calls = assignTherapistRoleBodies(source);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain("p_therapist_id:");
      expect(call).not.toContain("user_email:");
      expect(call).not.toMatch(/(^|\n)\s*therapist_id:/);
    }
  });

  it("marks every live message-thread Supabase client and provisions the observer profile", () => {
    const harnessSource = readRepoFile("tests/integration/_helpers/liveRlsHarness.ts");
    const messageSource = readRepoFile("tests/integration/rls.message-threads.access.test.ts");

    expect(harnessSource).toContain("export const createLiveRlsClient");
    expect(messageSource).toContain("createLiveRlsClient(");
    expect(messageSource).not.toMatch(/\bcreateClient<Database>\(/);
    expect(messageSource).toContain("app_metadata: observerAppMetadata");
    expect(messageSource).toContain("persistLiveRlsAppMetadata(");
    expect(messageSource).toContain("reconcileLiveRlsRole(");
    expect(messageSource).toContain('"provision_ci_rls_fixture_profile"');
  });

  it("seeds valid session-linked artifacts and guardian organization context", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");

    expect(source).toContain("session_id: context.sessionId");
    expect(source).toContain("program_id: programId");
    expect(source).toContain("goal_id: goalId");
    expect(source).toContain(".eq('id', context.goalId)");
    expect(source).toContain(".eq('id', context.programId)");
    expect(source).toContain("Synthetic guardian profile readback failed");
    expect(source).toContain(".select('organization_id, role, is_active')");
    expect(source).not.toContain("await provisionCiRlsProfile(guardianId");
    expect(source).toContain("headers: { 'x-request-id': correlationId }");
    expect(source).toContain("`error-${result.error.name}:${result.error.message}`");
    expect(source).not.toContain("'x-correlation-id'");
  });

  it("uses the deployed therapist status schema before assigning a therapist", () => {
    const source = readRepoFile("supabase/functions/assign-therapist-user/index.ts");

    expect(source).toContain(".select('id, full_name, status, organization_id, deleted_at')");
    expect(source).toContain("therapistData.status !== 'active'");
    expect(source).not.toContain("therapistData.is_active");
    expect(source).toContain(".from('profiles')");
    expect(source).toContain('callerProfile?.organization_id');
    expect(source).toContain('targetProfile.organization_id');
    expect(source).toContain('targetProfile.is_active !== true');
    expect(source).not.toContain('extractOrganizationId');
    expect(source).not.toContain('targetUser.user_metadata as');
  });
});
