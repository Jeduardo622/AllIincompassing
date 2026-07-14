import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/generated/database.types";
import {
  computeEnvironmentGuidance,
  resolveSupabaseTestEnv,
} from "../../../src/tests/security/supabaseEnv";

type TypedClient = SupabaseClient<Database, "public", Database["public"]>;

type AdminAuthFixture = {
  userId: string;
  email: string;
  password: string;
  organizationId: string | null;
};

type LiveRlsFixtureRole = "admin" | "therapist" | "none";

export const buildLiveRlsProfileFixture = (fixture: {
  userId: string;
  email: string;
  organizationId: string | null;
  role: LiveRlsFixtureRole;
}) => ({
  id: fixture.userId,
  email: fixture.email,
  organization_id: fixture.organizationId,
  role: fixture.role === "none" ? "client" as const : fixture.role,
  is_active: true,
});

type OrgDataFixture = {
  therapistId: string;
  clientId: string;
  sessionId: string;
  sessionHoldId: string;
  sessionHoldKey: string;
  billingRecordId: string;
};

export type LiveRlsHarness =
  | {
      enabled: false;
      required: boolean;
      skipReason: string;
    }
  | {
      enabled: true;
      orgAId: string;
      orgBId: string;
      orgA: OrgDataFixture;
      orgB: OrgDataFixture;
      orgAAdminUserId: string;
      orgBAdminUserId: string;
      orgATherapistUserId: string;
      orgBTherapistUserId: string;
      outsiderUserId: string;
      callTrustedDashboardRpc: (
        actorUserId: string,
        organizationId: string,
      ) => Promise<Awaited<ReturnType<SupabaseClient["rpc"]>>>;
      signInAdminA: () => Promise<TypedClient>;
      signInAdminB: () => Promise<TypedClient>;
      signInTherapistA: () => Promise<TypedClient>;
      signInTherapistB: () => Promise<TypedClient>;
      signInOutsider: () => Promise<TypedClient>;
      cleanup: () => Promise<void>;
    };

const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true";
};

const assignNamedRole = async (
  serviceClient: TypedClient,
  userId: string,
  roleName: "therapist",
): Promise<void> => {
  const roleLookup = await serviceClient.from("roles").select("id").eq("name", roleName).maybeSingle();
  if (roleLookup.error || !roleLookup.data?.id) {
    throw roleLookup.error ?? new Error(`Role lookup failed for ${roleName}`);
  }

  const insertResult = await serviceClient.from("user_roles").insert({
    user_id: userId,
    role_id: roleLookup.data.id,
    is_active: true,
  });
  if (insertResult.error && insertResult.error.code !== "23505") {
    throw insertResult.error;
  }
};

const createAuthFixture = async (
  serviceClient: TypedClient,
  options: {
    organizationId: string | null;
    role: LiveRlsFixtureRole;
    label: string;
  },
): Promise<AdminAuthFixture> => {
  const email = `${options.label}.${randomUUID()}@example.com`;
  const password = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;
  const userMetadata: Record<string, string> = {};
  if (options.organizationId) {
    userMetadata.organization_id = options.organizationId;
  }
  if (options.role !== "none") {
    userMetadata.role = options.role;
  }

  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (createUserError || !createdUser?.user) {
    throw createUserError ?? new Error("Admin user creation failed");
  }

  const userId = createdUser.user.id;

  try {
    if (options.role === "admin") {
      if (!options.organizationId) {
        throw new Error("Admin fixtures require an organization id");
      }
      const assignResult = await serviceClient.rpc("assign_admin_role", {
        user_email: email,
        organization_id: options.organizationId,
        reason: "integration-test bootstrap",
      });
      if (assignResult.error) {
        throw assignResult.error;
      }
    } else if (options.role === "therapist") {
      await assignNamedRole(serviceClient, userId, "therapist");
    }

    const profileResult = await serviceClient
      .from("profiles")
      .upsert(buildLiveRlsProfileFixture({
        userId,
        email,
        organizationId: options.organizationId,
        role: options.role,
      }), { onConflict: "id" });
    if (profileResult.error) {
      throw profileResult.error;
    }

    return { userId, email, password, organizationId: options.organizationId };
  } catch (fixtureError) {
    const deleteResult = await serviceClient.auth.admin.deleteUser(userId);
    if (deleteResult.error) {
      throw new AggregateError(
        [fixtureError, deleteResult.error],
        `Failed to create and roll back auth fixture ${options.label}`,
      );
    }
    throw fixtureError;
  }
};

const seedOrgData = async (
  serviceClient: TypedClient,
  organizationId: string,
  label: string,
  therapistId: string,
): Promise<OrgDataFixture> => {
  const clientId = randomUUID();
  const sessionId = randomUUID();

  const therapistInsert = await serviceClient.from("therapists").insert({
    id: therapistId,
    email: `${label}.therapist.${therapistId}@example.com`,
    first_name: label.toUpperCase(),
    last_name: "Therapist",
    full_name: `${label.toUpperCase()} Therapist`,
    specialties: ["aba"],
    max_clients: 5,
    status: "active",
    organization_id: organizationId,
  });
  if (therapistInsert.error) {
    throw therapistInsert.error;
  }

  const clientInsert = await serviceClient.from("clients").insert({
    id: clientId,
    email: `${label}.client.${clientId}@example.com`,
    full_name: `${label.toUpperCase()} Client`,
    date_of_birth: "2016-01-01",
    one_to_one_units: 4,
    supervision_units: 1,
    parent_consult_units: 1,
    assessment_units: 1,
    auth_units: 0,
    service_preference: [],
    insurance_info: {},
    availability_hours: {},
    organization_id: organizationId,
  });
  if (clientInsert.error) {
    throw clientInsert.error;
  }

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60 * 1000);
  const end = new Date(now.getTime() + 30 * 60 * 1000);
  const sessionInsert = await serviceClient.from("sessions").insert({
    id: sessionId,
    therapist_id: therapistId,
    client_id: clientId,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: "completed",
    notes: "",
    organization_id: organizationId,
    has_transcription_consent: true,
  });
  if (sessionInsert.error) {
    throw sessionInsert.error;
  }

  const billingInsert = await serviceClient
    .from("billing_records")
    .insert({
      session_id: sessionId,
      amount: 125,
      status: "pending",
      organization_id: organizationId,
    })
    .select("id")
    .single();
  if (billingInsert.error || !billingInsert.data) {
    throw billingInsert.error ?? new Error("Billing record creation failed");
  }

  const holdStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const holdEnd = new Date(holdStart.getTime() + 30 * 60 * 1000);
  const holdExpiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const sessionHoldKey = randomUUID();
  const holdInsert = await serviceClient
    .from("session_holds")
    .insert({
      therapist_id: therapistId,
      client_id: clientId,
      start_time: holdStart.toISOString(),
      end_time: holdEnd.toISOString(),
      expires_at: holdExpiresAt,
      organization_id: organizationId,
      hold_key: sessionHoldKey,
    })
    .select("id")
    .single();
  if (holdInsert.error || !holdInsert.data?.id) {
    throw holdInsert.error ?? new Error("Session hold creation failed");
  }

  return {
    therapistId,
    clientId,
    sessionId,
    sessionHoldId: holdInsert.data.id,
    sessionHoldKey,
    billingRecordId: billingInsert.data.id,
  };
};

const createUserClient = (
  supabaseUrl: string,
  supabaseAnonKey: string,
): TypedClient =>
  createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

export async function setupLiveRlsHarness(): Promise<LiveRlsHarness> {
  const importMetaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const isCiEnvironment = parseBooleanEnv(process.env.CI) || parseBooleanEnv(importMetaEnv.CI);
  const runDatabaseIntegrationTests = parseBooleanEnv(
    process.env.RUN_DB_IT ?? importMetaEnv.RUN_DB_IT,
  );
  const explicitlyEnabled = runDatabaseIntegrationTests;

  if (!explicitlyEnabled) {
    return {
      enabled: false,
      required: false,
      skipReason:
        "Live Supabase RLS tests are opt-in. Set RUN_DB_IT=1 to execute these tests against a Supabase integration environment.",
    };
  }

  const environmentResolution = await resolveSupabaseTestEnv({
    isCiEnvironment,
    runDatabaseIntegrationTests,
  });

  if (!environmentResolution.shouldRun) {
    const blockers = [...environmentResolution.blockers];
    if (environmentResolution.missing.length > 0) {
      blockers.unshift(`Missing environment variables: ${environmentResolution.missing.join(", ")}.`);
    }
    const guidance = computeEnvironmentGuidance(environmentResolution.missing);
    const skipReason = [
      "Live Supabase RLS tests are disabled because the environment is incomplete.",
      ...blockers,
      guidance,
    ]
      .filter(Boolean)
      .join(" ");
    return { enabled: false, required: explicitlyEnabled, skipReason };
  }

  const supabaseUrl = environmentResolution.supabaseUrl as string;
  const supabaseAnonKey = environmentResolution.supabaseAnonKey as string;
  const serviceRoleKey = environmentResolution.supabaseServiceRoleKey as string;
  const serviceClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const authUserIds: string[] = [];

  const cleanupCreatedResources = async (): Promise<void> => {
    const cleanupErrors: Error[] = [];
    const recordCleanup = async (
      label: string,
      action: () => Promise<{ error: { message: string } | null }>,
    ): Promise<void> => {
      try {
        const result = await action();
        if (result.error) {
          cleanupErrors.push(new Error(`${label}: ${result.error.message}`));
        }
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? new Error(`${label}: ${error.message}`) : new Error(`${label}: ${String(error)}`),
        );
      }
    };

    const organizationIds = [orgAId, orgBId];
    await recordCleanup("session holds", () =>
      serviceClient.from("session_holds").delete().in("organization_id", organizationIds),
    );
    await recordCleanup("billing records", () =>
      serviceClient.from("billing_records").delete().in("organization_id", organizationIds),
    );
    await recordCleanup("sessions", () =>
      serviceClient.from("sessions").delete().in("organization_id", organizationIds),
    );
    await recordCleanup("clients", () =>
      serviceClient.from("clients").delete().in("organization_id", organizationIds),
    );
    await recordCleanup("therapists", () =>
      serviceClient.from("therapists").delete().in("organization_id", organizationIds),
    );
    await recordCleanup("admin actions", () =>
      serviceClient.from("admin_actions").delete().in("organization_id", organizationIds),
    );
    if (authUserIds.length > 0) {
      await recordCleanup("user roles", () =>
        serviceClient.from("user_roles").delete().in("user_id", authUserIds),
      );
    }
    for (const userId of [...authUserIds].reverse()) {
      await recordCleanup(`auth user ${userId}`, () => serviceClient.auth.admin.deleteUser(userId));
    }
    await recordCleanup("organizations", () =>
      serviceClient.from("organizations").delete().in("id", [orgAId, orgBId]),
    );

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Failed to clean up live RLS fixture resources");
    }
  };

  let resources:
    | {
        orgAAdmin: AdminAuthFixture;
        orgBAdmin: AdminAuthFixture;
        orgATherapist: AdminAuthFixture;
        orgBTherapist: AdminAuthFixture;
        outsider: AdminAuthFixture;
        orgA: OrgDataFixture;
        orgB: OrgDataFixture;
      }
    | undefined;

  try {
    const organizationInsert = await serviceClient.from("organizations").insert([
      {
        id: orgAId,
        name: "Live RLS Organization A",
        slug: `live-rls-org-a-${orgAId}`,
      },
      {
        id: orgBId,
        name: "Live RLS Organization B",
        slug: `live-rls-org-b-${orgBId}`,
      },
    ]);
    if (organizationInsert.error) {
      throw organizationInsert.error;
    }

    const createTrackedAuthFixture = async (
      options: Parameters<typeof createAuthFixture>[1],
    ): Promise<AdminAuthFixture> => {
      const fixture = await createAuthFixture(serviceClient, options);
      authUserIds.push(fixture.userId);
      return fixture;
    };

    const orgAAdmin = await createTrackedAuthFixture({ organizationId: orgAId, role: "admin", label: "admin.org-a" });
    const orgBAdmin = await createTrackedAuthFixture({ organizationId: orgBId, role: "admin", label: "admin.org-b" });
    const orgATherapist = await createTrackedAuthFixture({
      organizationId: orgAId,
      role: "therapist",
      label: "therapist.org-a",
    });
    const orgBTherapist = await createTrackedAuthFixture({
      organizationId: orgBId,
      role: "therapist",
      label: "therapist.org-b",
    });
    const outsider = await createTrackedAuthFixture({
      organizationId: null,
      role: "none",
      label: "outsider",
    });
    const orgA = await seedOrgData(serviceClient, orgAId, "org-a", orgATherapist.userId);
    const orgB = await seedOrgData(serviceClient, orgBId, "org-b", orgBTherapist.userId);
    resources = { orgAAdmin, orgBAdmin, orgATherapist, orgBTherapist, outsider, orgA, orgB };
  } catch (setupError) {
    try {
      await cleanupCreatedResources();
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        "Failed to set up and roll back live RLS fixture resources",
      );
    }
    throw setupError;
  }

  const { orgAAdmin, orgBAdmin, orgATherapist, orgBTherapist, outsider, orgA, orgB } = resources;

  const signInAdmin = async (admin: AdminAuthFixture): Promise<TypedClient> => {
    const client = createUserClient(supabaseUrl, supabaseAnonKey);
    const signInResult = await client.auth.signInWithPassword({
      email: admin.email,
      password: admin.password,
    });
    if (signInResult.error) {
      throw signInResult.error;
    }
    return client;
  };

  const cleanup = cleanupCreatedResources;

  return {
    enabled: true,
    orgAId,
    orgBId,
    orgA,
    orgB,
    orgAAdminUserId: orgAAdmin.userId,
    orgBAdminUserId: orgBAdmin.userId,
    orgATherapistUserId: orgATherapist.userId,
    orgBTherapistUserId: orgBTherapist.userId,
    outsiderUserId: outsider.userId,
    callTrustedDashboardRpc: (actorUserId: string, organizationId: string) =>
      serviceClient.rpc("get_dashboard_data_for_org", {
        actor_user_id: actorUserId,
        target_organization_id: organizationId,
      }),
    signInAdminA: () => signInAdmin(orgAAdmin),
    signInAdminB: () => signInAdmin(orgBAdmin),
    signInTherapistA: () => signInAdmin(orgATherapist),
    signInTherapistB: () => signInAdmin(orgBTherapist),
    signInOutsider: () => signInAdmin(outsider),
    cleanup,
  };
}
