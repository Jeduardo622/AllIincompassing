import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { handleFeatureFlagAdmin } from "./index.ts";

type TableResponse = { data: unknown; error: unknown };

const createListClient = (responses: Record<string, TableResponse>): SupabaseClient => {
  return {
    from: (table: string) => {
      const response = responses[table];
      if (!response) {
        throw new Error(`Unexpected table requested: ${table}`);
      }

      if (table === "feature_flags" || table === "organizations" || table === "plans") {
        return {
          select: () => ({
            order: () => Promise.resolve(response),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      return {
        select: () => Promise.resolve(response),
      } as unknown as ReturnType<SupabaseClient["from"]>;
    },
  } as unknown as SupabaseClient;
};

const createRequest = (method: string, body: unknown) =>
  new Request("https://example.com/feature-flags", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });

const createUserContext = (): UserContext => ({
  user: { id: "super-admin-1", email: "super@example.com" },
  profile: { id: "profile-1", email: "super@example.com", role: "super_admin", is_active: true },
});

Deno.test("returns 405 when using a non-POST method", async () => {
  const response = await handleFeatureFlagAdmin({
    req: createRequest("GET", null),
    userContext: createUserContext(),
    db: createListClient({}),
  });

  assertEquals(response.status, 405);
});

Deno.test("lists feature flag administration data for super admins", async () => {
  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", { action: "list" }),
    userContext: createUserContext(),
    db: createListClient({
      feature_flags: { data: [{ id: "flag-1", flag_key: "new-dashboard" }], error: null },
      organizations: { data: [{ id: "org-1", name: "Acme" }], error: null },
      organization_feature_flags: { data: [{ id: "of-1", organization_id: "org-1", feature_flag_id: "flag-1" }], error: null },
      plans: { data: [{ code: "standard", name: "Standard" }], error: null },
      organization_plans: { data: [{ organization_id: "org-1", plan_code: "standard" }], error: null },
    }),
  });

  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(Array.isArray(body.flags), true);
  assertEquals(Array.isArray(body.organizations), true);
  assertEquals(body.flags.length, 1);
  assertEquals(body.organizations[0].id, "org-1");
  assertEquals(body.organizationPlans[0].plan_code, "standard");
});

Deno.test("creates feature flags and writes audit logs", async () => {
  const inserted: unknown[] = [];
  const audits: unknown[] = [];

  const client = {
    from: (table: string) => {
      if (table === "feature_flags") {
        return {
          insert: (values: Record<string, unknown>) => {
            inserted.push(values);
            const payload = values as {
              flag_key: string;
              description?: string | null;
              default_enabled?: boolean;
            };
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "flag-123",
                      flag_key: payload.flag_key,
                      description: payload.description ?? null,
                      default_enabled: payload.default_enabled ?? false,
                      metadata: null,
                      created_at: "now",
                      updated_at: "now",
                    },
                    error: null,
                  }),
              }),
            };
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "feature_flag_audit_logs") {
        return {
          insert: (values: Record<string, unknown>) => {
            audits.push(values);
            return Promise.resolve({ data: null, error: null });
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", {
      action: "createFlag",
      flagKey: "beta-dashboard",
      description: "Beta dashboard",
      defaultEnabled: true,
    }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 201);
  assertEquals(inserted.length, 1);
  const insertedRecord = inserted[0] as { flag_key: string; default_enabled: boolean };
  assertEquals(insertedRecord.flag_key, "beta-dashboard");
  assertEquals(insertedRecord.default_enabled, true);
  assertEquals(audits.length, 1);
  const auditRecord = audits[0] as {
    action: string;
    actor_id: string;
    feature_flag_id: string;
  };
  assertEquals(auditRecord.action, "create_flag");
  assertEquals(auditRecord.actor_id, "super-admin-1");
  assertEquals(auditRecord.feature_flag_id, "flag-123");
});

Deno.test("removes plan assignments when planCode is null", async () => {
  const deleteCalls: string[] = [];
  const audits: unknown[] = [];

  const existingAssignment = {
    organization_id: "org-1",
    plan_code: "standard",
    assigned_at: "yesterday",
    assigned_by: "super-admin-0",
    notes: "Existing plan",
  };

  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: "org-1", name: "Acme" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "organization_plans") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: existingAssignment, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => {
                  deleteCalls.push("delete");
                  return Promise.resolve({ data: existingAssignment, error: null });
                },
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "feature_flag_audit_logs") {
        return {
          insert: (values: Record<string, unknown>) => {
            audits.push(values);
            return Promise.resolve({ data: null, error: null });
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", { action: "setOrgPlan", organizationId: "org-1", planCode: null }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  assertEquals(deleteCalls.length, 1);
  assertEquals(audits.length, 1);
  const auditRecord = audits[0] as {
    action: string;
    previous_state: typeof existingAssignment;
    new_state: unknown;
  };
  assertEquals(auditRecord.action, "set_org_plan");
  assertEquals(auditRecord.previous_state, existingAssignment);
  assertEquals(auditRecord.new_state, null);
});

Deno.test("updates existing organizations and normalizes slugs", async () => {
  const updates: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const existingOrganization = {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    metadata: { tier: "standard" },
    created_at: "yesterday",
    updated_at: "yesterday",
  };

  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: existingOrganization, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        ...existingOrganization,
                        ...values,
                        updated_at: "now",
                      },
                      error: null,
                    }),
                }),
              }),
            };
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "feature_flag_audit_logs") {
        return {
          insert: (values: Record<string, unknown>) => {
            audits.push(values);
            return Promise.resolve({ data: null, error: null });
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", {
      action: "upsertOrganization",
      organization: {
        id: "org-1",
        name: "Acme Beta",
        slug: "Acme Beta",
      },
    }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as {
    organization: { slug: string; updated_at: string };
  };
  assertEquals(body.organization.slug, "acme-beta");
  assertEquals(updates.length, 1);
  const updatePayload = updates[0] as { slug: string; updated_by: string };
  assertEquals(updatePayload.slug, "acme-beta");
  assertEquals(updatePayload.updated_by, "super-admin-1");
  assertEquals(audits.length, 1);
  const auditRecord = audits[0] as {
    action: string;
    previous_state: typeof existingOrganization;
  };
  assertEquals(auditRecord.action, "update_organization");
  assertEquals(auditRecord.previous_state, existingOrganization);
  assert(body.organization.updated_at);
});

Deno.test("rejects invalid organization metadata", async () => {
  let tableRequested = false;

  const client = {
    from: () => {
      tableRequested = true;
      throw new Error("Database should not be queried when metadata is invalid");
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", {
      action: "upsertOrganization",
      organization: {
        id: "6f299315-15d6-4a86-8bb8-1f9f60dedaf5",
        metadata: {
          seats: {
            licensed: 5,
            active: 8,
          },
        },
      },
    }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(tableRequested, false);
  assertEquals(response.status, 400);
  const body = (await response.json()) as { error: string };
  assertEquals(body.error.includes("Invalid organization metadata"), true);
});

Deno.test("persists sanitized organization metadata", async () => {
  const updates: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const existingOrganization = {
    id: "org-2",
    name: "Bright Future",
    slug: "bright-future",
    metadata: { notes: "legacy" },
    created_at: "yesterday",
    updated_at: "yesterday",
  };

  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: existingOrganization, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        ...existingOrganization,
                        ...values,
                        metadata: values.metadata,
                        updated_at: "now",
                      },
                      error: null,
                    }),
                }),
              }),
            };
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "feature_flag_audit_logs") {
        return {
          insert: (values: Record<string, unknown>) => {
            audits.push(values);
            return Promise.resolve({ data: null, error: null });
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", {
      action: "upsertOrganization",
      organization: {
        id: "org-2",
        metadata: {
          billing: {
            contact: {
              name: "  Casey Ops  ",
              email: "ops@example.com  ",
            },
            cycle: "monthly",
          },
          seats: { licensed: 50, active: 25 },
          tags: ["beta", "priority"],
        },
      },
    }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  assertEquals(updates.length, 1);
  const updatePayload = updates[0] as { metadata?: Record<string, unknown> };
  assert(updatePayload.metadata);
  const metadata = updatePayload.metadata as {
    billing: { contact: { name: string; email: string } };
    seats: { licensed: number; active: number };
    tags: string[];
  };
  assertEquals(metadata.billing.contact.name, "Casey Ops");
  assertEquals(metadata.billing.contact.email, "ops@example.com");
  assertEquals(metadata.seats.active, 25);
  assertEquals(metadata.tags.includes("beta"), true);
  assertEquals(audits.length, 1);
});
