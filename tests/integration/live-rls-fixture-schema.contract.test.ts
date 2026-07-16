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
    const unitTestStep = testMainJob?.match(
      /      - name: Run unit tests\n([\s\S]*?)      - name: Run hosted database tests serially/,
    )?.[1];
    const hostedTestStep = testMainJob?.match(
      /      - name: Run hosted database tests serially\n([\s\S]*?)      - name: Record Supabase validate evidence/,
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
    expect(pushSection).toContain(
      "      - 'src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts'",
    );
    expect(pushSection).toContain("      - 'src/tests/security/rls.spec.ts'");
    expect(pushSection).toContain("      - 'tests/integration/rls.message-threads.access.test.ts'");
    expect(pushSection).toContain("      - 'tests/integration/rls.session-holds.access.test.ts'");
    expect(pushSection).toContain("      - 'tests/integration/rls.sessions.read-write.test.ts'");
    expect(pushSection).toContain("      - 'tests/integration/rls.therapists.clients.billing.test.ts'");
    expect(pushSection).toContain("      - 'tests/integration/rpc.dashboard.org-scope.test.ts'");
    expect(pushSection).toContain("      - main");
    expect(pullRequestSection).not.toContain("liveRlsHarness.ts");
    expect(pullRequestSection).not.toContain(
      "live-rls-fixture-schema.contract.test.ts",
    );
    expect(pullRequestSection).not.toContain("rls.spec.ts");
    expect(testMainJob).toContain("    if: github.event_name == 'push'");
    expect(testMainJob).toContain("    timeout-minutes: 30");
    expect(unitTestStep).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(unitTestStep).not.toContain("RUN_DB_IT");
    expect(unitTestStep).toContain("--exclude=src/lib/__tests__/DatabaseIntegration.test.ts");
    expect(unitTestStep).toContain("--exclude=src/lib/__tests__/multiTenantAccess.test.ts");
    expect(unitTestStep).toContain("--exclude=src/tests/security/rls.spec.ts");
    expect(unitTestStep).toContain("--exclude=tests/integration/rls.message-threads.access.test.ts");
    expect(unitTestStep).toContain("--exclude=tests/integration/rls.session-holds.access.test.ts");
    expect(unitTestStep).toContain("--exclude=tests/integration/rls.sessions.read-write.test.ts");
    expect(unitTestStep).toContain("--exclude=tests/integration/rls.therapists.clients.billing.test.ts");
    expect(unitTestStep).toContain("--exclude=tests/integration/rpc.dashboard.org-scope.test.ts");
    expect(hostedTestStep).toContain("--no-file-parallelism");
    expect(hostedTestStep).toContain("--maxWorkers=1");
    expect(hostedTestStep).toContain("--hookTimeout=120000");
    expect(hostedTestStep).toContain("--testTimeout=60000");
    expect(hostedTestStep).not.toContain("src/lib/__tests__/DatabaseIntegration.test.ts");
    expect(hostedTestStep).not.toContain("src/lib/__tests__/multiTenantAccess.test.ts");
    expect(hostedTestStep).toContain("src/tests/security/rls.spec.ts");
    expect(hostedTestStep).toContain("tests/integration/rls.message-threads.access.test.ts");
    expect(hostedTestStep).toContain("tests/integration/rls.session-holds.access.test.ts");
    expect(hostedTestStep).toContain("tests/integration/rls.sessions.read-write.test.ts");
    expect(hostedTestStep).toContain("tests/integration/rls.therapists.clients.billing.test.ts");
    expect(hostedTestStep).toContain("tests/integration/rpc.dashboard.org-scope.test.ts");
    expect(hostedTestStep).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY || secrets.SUPABASE_SECRET_KEY }}",
    );
    expect(hostedTestStep).toContain("RUN_DB_IT: '1'");
    expect(hostedTestStep).toContain("VITEST_HANG_TIMEOUT_MS: '180000'");
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
    expect(source.match(/createdFixtureAuthUserIds\.push\(/g)).toHaveLength(4);
    expect(source).toContain(".from('user_therapist_links').insert({");
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

  it("creates the mapped therapist link before guarded profile provisioning", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const mappedFixture = source.match(
      /const createMappedTherapistFixture[\s\S]*?const createTherapistCertificationFixture/,
    )?.[0];

    expect(mappedFixture).toBeTruthy();
    const profileProvision = mappedFixture!.indexOf(
      "await provisionCiRlsProfile(userId, tenant.organizationId, 'therapist')",
    );
    const therapistLink = mappedFixture!.indexOf(
      ".from('user_therapist_links').insert({",
    );

    expect(therapistLink).toBeGreaterThan(-1);
    expect(profileProvision).toBeGreaterThan(therapistLink);
    expect(mappedFixture).toContain("therapist_id: tenant.therapistId");
    expect(mappedFixture).not.toContain(".from('therapists').insert({");
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

  it("provisions canonical admin profiles before invoking assign_admin_role", () => {
    const harnessSource = readRepoFile("tests/integration/_helpers/liveRlsHarness.ts");
    const securitySource = readRepoFile("src/tests/security/rls.spec.ts");
    const messageSource = readRepoFile("tests/integration/rls.message-threads.access.test.ts");

    const harnessAdminSetup = harnessSource.match(
      /const createAuthFixture[\s\S]*?\n};\n\nconst seedOrgData/,
    )?.[0];
    const securityAdminSetup = securitySource.match(
      /const createAdminFixture[\s\S]*?\n};\n\nconst createTherapistCertificationFixture/,
    )?.[0];
    const securityProvisioner = securitySource.match(
      /const provisionCiRlsProfile[\s\S]*?\n};\n\nconst createTenantFixture/,
    )?.[0];
    const messageAdminSetup = messageSource.match(
      /beforeAll\(async \(\) => \{[\s\S]*?\n}\);\n\nafterAll/,
    )?.[0];

    expect(harnessAdminSetup).toBeTruthy();
    expect(securityAdminSetup).toBeTruthy();
    expect(securityProvisioner).toBeTruthy();
    expect(messageAdminSetup).toBeTruthy();

    const expectOrdered = (source: string, tokens: string[]) => {
      const indexes = tokens.map((token) => source.indexOf(token));
      for (const index of indexes) {
        expect(index).toBeGreaterThan(-1);
      }
      expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    };

    expectOrdered(harnessAdminSetup!, [
      "await persistLiveRlsAppMetadata(",
      "await reconcileLiveRlsRole(",
      '"provision_ci_rls_fixture_profile"',
      'rpc("assign_admin_role"',
    ]);
    expectOrdered(securityProvisioner!, [
      "await persistCiRlsAppMetadata(",
      "await reconcileCiRlsFixtureRole(",
      "rpc('provision_ci_rls_fixture_profile'",
    ]);
    expectOrdered(securityAdminSetup!, [
      "await provisionCiRlsProfile(userId, organizationId, 'admin')",
      "rpc('assign_admin_role'",
    ]);
    expectOrdered(messageAdminSetup!, [
      "await persistLiveRlsAppMetadata(",
      "await reconcileLiveRlsRole(",
      '"provision_ci_rls_fixture_profile"',
      'rpc("assign_admin_role"',
    ]);
  });

  it("seeds valid session-linked artifacts and guardian organization context", () => {
    const source = readRepoFile("src/tests/security/rls.spec.ts");
    const guardianSetup = source.match(
      /const createGuardianFixture[\s\S]*?\n};\n\nbeforeAll/,
    )?.[0];

    expect(source).toContain("session_id: context.sessionId");
    expect(source).toContain("program_id: programId");
    expect(source).toContain("goal_id: goalId");
    expect(source).toContain(".eq('id', context.goalId)");
    expect(source).toContain(".eq('id', context.programId)");
    expect(source).toContain("Synthetic guardian profile readback failed");
    expect(source).toContain(".select('organization_id, role, is_active')");
    expect(source).toContain(
      "await provisionCiRlsProfile(guardianId, tenant.organizationId, 'client')",
    );
    expect(guardianSetup).toBeTruthy();
    expect(guardianSetup!.indexOf(".from('client_guardians')")).toBeLessThan(
      guardianSetup!.indexOf(
        "await provisionCiRlsProfile(guardianId, tenant.organizationId, 'client')",
      ),
    );
    expect(source).toContain("`${SUPABASE_URL}/functions/v1/assign-therapist-user`");
    expect(source).toContain("'x-request-id': correlationId");
    expect(source).toContain('const actorAccessTokensByClient = new WeakMap<TypedClient, string>()');
    expect(source).toContain('actorAccessTokensByClient.set(client, accessToken)');
    expect(source).toContain('const accessToken = actorAccessTokensByClient.get(client)');
    expect(source).toContain("Authorization: `Bearer ${accessToken}`");
    expect(source).toContain("apikey: SUPABASE_ANON_KEY");
    expect(source).toContain('signal: AbortSignal.timeout(45_000)');
    expect(source).not.toContain("client.functions.invoke('assign-therapist-user'");
    expect(source).not.toContain('client.auth.getSession()');
    expect(source).toContain('response.ok');
    expect(source).toContain('context: response');
    expect(source).toContain("data = { error: 'Non-JSON Edge Function response' }");
    expect(source.match(/}, 75_000\);/g)).toHaveLength(2);
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
    expect(source).not.toContain('createProtectedRoute');
    expect(source).not.toContain('RouteOptions.admin');
    expect(source).toContain('handleCors(req)');
    expect(source).toContain('Deno.serve(handler)');
    expect(source).toContain('getGatewayVerifiedCallerId(req)');
    expect(source).toContain('extractBearerToken');
    expect(source).not.toContain('getUserOrThrow');
    expect(source).toContain('resolveAssignmentAdminRole(adminClient, callerOrganizationId)');
    expect(source).toContain("client.rpc('current_user_is_super_admin')");
    expect(source).toContain("client.rpc('user_has_role_for_org'");
    expect(source).not.toContain('assertAdminOrSuperAdmin');

    const config = readRepoFile('supabase/config.toml');
    expect(config).toContain('[functions.assign-therapist-user]\nverify_jwt = true');
  });

  it("authorizes synthetic guardian profiles only from unambiguous active client links", () => {
    const migration = readRepoFile(
      "supabase/migrations/20260715212045_support_ci_rls_guardian_client.sql",
    );

    expect(migration).toContain("from public.client_guardians cg");
    expect(migration).toContain("join public.clients c on c.id = cg.client_id");
    expect(migration).toContain("cg.guardian_id = p_user_id");
    expect(migration).toContain("cg.deleted_at is null");
    expect(migration).toContain("cg.organization_id = c.organization_id");
    expect(migration).toContain("c.deleted_at is null");
    expect(migration).toContain("count(distinct client_authority.organization_id)");
    expect(migration).toContain("Synthetic RLS actor client mapping is ambiguous");
    expect(migration).toContain("u.raw_app_meta_data ->> 'ci_rls_fixture' = 'true'");
    expect(migration).toContain("lower(actor_email) like '%.%@example.com'");
    expect(migration).toContain("actor_expiry_text::timestamptz > now()");
    expect(migration).toContain("coalesce(ur.is_active, true) = true");
    expect(migration).toContain("ur.expires_at is null or ur.expires_at > now()");
    expect(migration).toContain("distinct_role_count <> 1");
    expect(migration).toContain("r.name in ('client', 'therapist', 'admin')");
    expect(migration).toContain("Synthetic RLS actor therapist mapping is ambiguous");
    expect(migration).toContain("resolved_organization_id <> p_organization_id");
    expect(migration).toContain("set_config('app.bypass_profile_role_guard', 'on', true)");
    expect(migration.match(/set_config\('app\.bypass_profile_role_guard', 'off', true\)/g)).toHaveLength(2);
    expect(migration).toContain("if updated_rows <> 1 then");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) from public");
    expect(migration).toContain("revoke execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) from anon");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from authenticated");
    expect(migration.match(/grant execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) to service_role/g)).toHaveLength(1);
    expect(migration).not.toContain("create table");
    expect(migration).not.toContain("alter table");
    expect(migration).not.toContain("create policy");
    expect(migration).not.toContain("drop policy");
  });
});
