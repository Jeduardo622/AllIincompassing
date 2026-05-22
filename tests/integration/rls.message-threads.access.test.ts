import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/lib/generated/database.types";
import {
  computeEnvironmentGuidance,
  resolveSupabaseTestEnv,
} from "../../src/tests/security/supabaseEnv";
import { setupLiveRlsHarness, type LiveRlsHarness } from "./_helpers/liveRlsHarness.ts";

type TypedClient = SupabaseClient<Database, "public", Database["public"]>;

let harness: LiveRlsHarness = {
  enabled: false,
  required: false,
  skipReason: "Harness not initialized.",
};

let orgAObserverAdmin: { userId: string; email: string; password: string } | null = null;
let serviceClient: TypedClient | null = null;
let createdThreadIds: string[] = [];

const syntheticBody = "Synthetic staff coordination note — no client identifiers.";

const expectRlsFailure = (error: { message?: string } | null): void => {
  expect(error).not.toBeNull();
  expect((error?.message ?? "").toLowerCase()).toMatch(
    /row-level security|permission|not allowed|violat|42501|28000/,
  );
};

beforeAll(async () => {
  harness = await setupLiveRlsHarness();

  if (!harness.enabled) {
    return;
  }

  const importMetaEnv =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const isCiEnvironment = Boolean(process.env.CI) || importMetaEnv.CI === "true";
  const environmentResolution = await resolveSupabaseTestEnv({
    isCiEnvironment,
    runDatabaseIntegrationTests: true,
  });

  if (!environmentResolution.shouldRun || !environmentResolution.supabaseServiceRoleKey) {
    return;
  }

  serviceClient = createClient<Database>(
    environmentResolution.supabaseUrl as string,
    environmentResolution.supabaseServiceRoleKey as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const email = `observer.admin.${Date.now()}.${randomUUID().slice(0, 8)}@example.com`;
  const password = `P@ssw0rd-${randomUUID().slice(0, 8)}`;
  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: harness.orgAId, role: "admin" },
  });
  if (createUserError || !createdUser?.user) {
    throw createUserError ?? new Error("Observer admin creation failed");
  }

  const assignResult = await serviceClient.rpc("assign_admin_role", {
    user_email: email,
    organization_id: harness.orgAId,
    reason: "integration-test observer admin",
  });
  if (assignResult.error) {
    throw assignResult.error;
  }

  orgAObserverAdmin = { userId: createdUser.user.id, email, password };
});

afterAll(async () => {
  if (serviceClient && createdThreadIds.length > 0) {
    await serviceClient.from("messages").delete().in("thread_id", createdThreadIds);
    await serviceClient.from("message_thread_participants").delete().in("thread_id", createdThreadIds);
    await serviceClient.from("message_threads").delete().in("id", createdThreadIds);
  }

  if (serviceClient && orgAObserverAdmin) {
    await serviceClient.auth.admin.deleteUser(orgAObserverAdmin.userId);
  }

  if (harness.enabled) {
    await harness.cleanup();
  }
});

const createDirectThread = async (
  client: TypedClient,
  participantIds: string[],
  subject = "Synthetic direct thread",
): Promise<string> => {
  const { data, error } = await client.rpc("create_staff_message_thread", {
    p_subject: subject,
    p_thread_type: "direct",
    p_participant_user_ids: participantIds,
  });

  expect(error).toBeNull();
  expect(typeof data).toBe("string");
  const threadId = data as string;
  createdThreadIds.push(threadId);
  return threadId;
};

describe("RLS staff messaging (live Supabase)", () => {
  it("allows participants to read their thread and messages", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const threadId = await createDirectThread(therapistClient, [
      harness.orgATherapistUserId,
      harness.orgAAdminUserId,
    ]);

    const therapistThread = await therapistClient
      .from("message_threads")
      .select("id, organization_id, thread_type")
      .eq("id", threadId)
      .maybeSingle();
    expect(therapistThread.error).toBeNull();
    expect(therapistThread.data?.id).toBe(threadId);

    const insertMessage = await therapistClient.from("messages").insert({
      thread_id: threadId,
      sender_id: harness.orgATherapistUserId,
      body: syntheticBody,
    });
    expect(insertMessage.error).toBeNull();

    const adminClient = await harness.signInAdminA();
    const adminMessages = await adminClient
      .from("messages")
      .select("id, body, thread_id")
      .eq("thread_id", threadId);
    expect(adminMessages.error).toBeNull();
    expect((adminMessages.data ?? []).length).toBeGreaterThan(0);
  });

  it("denies same-org admin who is not a participant", async () => {
    if (!harness.enabled || !orgAObserverAdmin) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const threadId = await createDirectThread(therapistClient, [
      harness.orgATherapistUserId,
      harness.orgAAdminUserId,
    ]);

    const env = await resolveSupabaseTestEnv({
      isCiEnvironment: Boolean(process.env.CI),
      runDatabaseIntegrationTests: true,
    });
    if (!env.shouldRun || !env.supabaseAnonKey) {
      throw new Error(computeEnvironmentGuidance(env.missing));
    }

    const observerClient = createClient<Database>(env.supabaseUrl as string, env.supabaseAnonKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await observerClient.auth.signInWithPassword({
      email: orgAObserverAdmin.email,
      password: orgAObserverAdmin.password,
    });
    expect(signIn.error).toBeNull();

    const threadRead = await observerClient
      .from("message_threads")
      .select("id")
      .eq("id", threadId);
    expect((threadRead.data ?? []).length).toBe(0);

    const messageRead = await observerClient
      .from("messages")
      .select("id, body")
      .eq("thread_id", threadId);
    expect((messageRead.data ?? []).length).toBe(0);
  });

  it("denies cross-org reads and message inserts", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const threadId = await createDirectThread(therapistClient, [
      harness.orgATherapistUserId,
      harness.orgAAdminUserId,
    ]);

    const orgBAdminClient = await harness.signInAdminB();
    const crossOrgThread = await orgBAdminClient
      .from("message_threads")
      .select("id")
      .eq("id", threadId);
    expect((crossOrgThread.data ?? []).length).toBe(0);

    const crossOrgInsert = await orgBAdminClient.from("messages").insert({
      thread_id: threadId,
      sender_id: harness.orgBAdminUserId,
      body: syntheticBody,
    });
    expectRlsFailure(crossOrgInsert.error);
  });

  it("rejects therapist group thread creation at RPC layer", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const { error } = await therapistClient.rpc("create_staff_message_thread", {
      p_subject: "Synthetic group attempt",
      p_thread_type: "group",
      p_participant_user_ids: [harness.orgATherapistUserId, harness.orgAAdminUserId],
    });

    expect(error).not.toBeNull();
    expect((error?.message ?? "").toLowerCase()).toMatch(/therapists may only create direct threads|42501/);
  });

  it("allows admin group thread creation within active same-org staff", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const adminClient = await harness.signInAdminA();
    const { data, error } = await adminClient.rpc("create_staff_message_thread", {
      p_subject: "Synthetic group thread",
      p_thread_type: "group",
      p_participant_user_ids: [
        harness.orgAAdminUserId,
        harness.orgATherapistUserId,
        ...(orgAObserverAdmin ? [orgAObserverAdmin.userId] : []),
      ],
    });

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    createdThreadIds.push(data as string);
  });

  it("allows participants to resolve thread participant display names via RPC", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const threadId = await createDirectThread(therapistClient, [
      harness.orgATherapistUserId,
      harness.orgAAdminUserId,
    ]);

    const therapistNames = await therapistClient.rpc("list_staff_message_thread_participant_names", {
      p_thread_id: threadId,
    });
    expect(therapistNames.error).toBeNull();
    const therapistRows = therapistNames.data ?? [];
    expect(therapistRows.length).toBeGreaterThanOrEqual(2);
    expect(therapistRows.some((row) => row.user_id === harness.orgATherapistUserId)).toBe(true);
    expect(therapistRows.some((row) => row.user_id === harness.orgAAdminUserId)).toBe(true);
    expect(therapistRows.every((row) => typeof row.full_name === "string" && row.full_name.length > 0)).toBe(
      true,
    );

    if (!orgAObserverAdmin) {
      return;
    }

    const env = await resolveSupabaseTestEnv({
      isCiEnvironment: Boolean(process.env.CI),
      runDatabaseIntegrationTests: true,
    });
    if (!env.shouldRun || !env.supabaseAnonKey) {
      throw new Error(computeEnvironmentGuidance(env.missing));
    }

    const observerClient = createClient<Database>(env.supabaseUrl as string, env.supabaseAnonKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await observerClient.auth.signInWithPassword({
      email: orgAObserverAdmin.email,
      password: orgAObserverAdmin.password,
    });
    expect(signIn.error).toBeNull();

    const deniedNames = await observerClient.rpc("list_staff_message_thread_participant_names", {
      p_thread_id: threadId,
    });
    expect(deniedNames.error).not.toBeNull();
    expect((deniedNames.error?.message ?? "").toLowerCase()).toMatch(
      /not a participant|permission|42501|28000/,
    );
  });

  it("limits participant-local archive updates to the owning participant", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const threadId = await createDirectThread(therapistClient, [
      harness.orgATherapistUserId,
      harness.orgAAdminUserId,
    ]);

    const archiveAt = new Date().toISOString();
    const selfArchive = await therapistClient
      .from("message_thread_participants")
      .update({ archived_at: archiveAt })
      .eq("thread_id", threadId)
      .eq("user_id", harness.orgATherapistUserId);
    expect(selfArchive.error).toBeNull();

    const adminClient = await harness.signInAdminA();
    const crossParticipantArchive = await adminClient
      .from("message_thread_participants")
      .update({ archived_at: archiveAt })
      .eq("thread_id", threadId)
      .eq("user_id", harness.orgATherapistUserId);
    expect((crossParticipantArchive.data ?? []).length).toBe(0);
  });
});
