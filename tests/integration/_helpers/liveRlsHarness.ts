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
  organizationId: string;
};

type OrgDataFixture = {
  therapistId: string;
  clientId: string;
  sessionId: string;
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
      signInAdminA: () => Promise<TypedClient>;
      signInAdminB: () => Promise<TypedClient>;
      cleanup: () => Promise<void>;
    };

const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true";
};

const createAdminFixture = async (
  serviceClient: TypedClient,
  organizationId: string,
): Promise<AdminAuthFixture> => {
  const email = `admin.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: organizationId },
  });

  if (createUserError || !createdUser?.user) {
    throw createUserError ?? new Error("Admin user creation failed");
  }

  const userId = createdUser.user.id;

  const assignResult = await serviceClient.rpc("assign_admin_role", {
    user_email: email,
    organization_id: organizationId,
    reason: "integration-test bootstrap",
  });
  if (assignResult.error) {
    throw assignResult.error;
  }

  return { userId, email, password, organizationId };
};

const seedOrgData = async (
  serviceClient: TypedClient,
  organizationId: string,
  label: string,
): Promise<OrgDataFixture> => {
  const therapistId = randomUUID();
  const clientId = randomUUID();
  const sessionId = randomUUID();

  const therapistInsert = await serviceClient.from("therapists").insert({
    id: therapistId,
    email: `${label}.therapist.${Date.now()}@example.com`,
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
    email: `${label}.client.${Date.now()}@example.com`,
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

  return {
    therapistId,
    clientId,
    sessionId,
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
  const orgAAdmin = await createAdminFixture(serviceClient, orgAId);
  const orgBAdmin = await createAdminFixture(serviceClient, orgBId);
  const orgA = await seedOrgData(serviceClient, orgAId, "org-a");
  const orgB = await seedOrgData(serviceClient, orgBId, "org-b");

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

  const cleanup = async (): Promise<void> => {
    await serviceClient.from("billing_records").delete().in("id", [orgA.billingRecordId, orgB.billingRecordId]);
    await serviceClient.from("sessions").delete().in("id", [orgA.sessionId, orgB.sessionId]);
    await serviceClient.from("clients").delete().in("id", [orgA.clientId, orgB.clientId]);
    await serviceClient.from("therapists").delete().in("id", [orgA.therapistId, orgB.therapistId]);
    await serviceClient.auth.admin.deleteUser(orgAAdmin.userId);
    await serviceClient.auth.admin.deleteUser(orgBAdmin.userId);
  };

  return {
    enabled: true,
    orgAId,
    orgBId,
    orgA,
    orgB,
    signInAdminA: () => signInAdmin(orgAAdmin),
    signInAdminB: () => signInAdmin(orgBAdmin),
    cleanup,
  };
}
