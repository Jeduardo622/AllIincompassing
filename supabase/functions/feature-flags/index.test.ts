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

Deno.test("does not overwrite metadata when omitted in organization update", async () => {
  const updates: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const existingOrganization = {
    id: "org-3",
    name: "Gamma",
    slug: "gamma",
    metadata: { tier: "enterprise", tags: ["vip"] },
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
                      data: { ...existingOrganization, ...values, updated_at: "now" },
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
      organization: { id: "org-3", name: "Gamma Updated" },
    }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { organization: { metadata: unknown } };
  assertEquals(updates.length, 1);
  const updatePayload = updates[0] as Record<string, unknown>;
  assertEquals("metadata" in updatePayload, false);
  assertEquals(body.organization.metadata, existingOrganization.metadata);
  assertEquals(audits.length, 1);
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

Deno.test("updates global flag and writes audit logs", async () => {
  const audits: unknown[] = [];

  const existingFlag = {
    id: "flag-xyz",
    flag_key: "deep-insights",
    description: "Deep insights feature",
    default_enabled: false,
    metadata: null,
    created_at: "yesterday",
    updated_at: "yesterday",
  };

  const client = {
    from: (table: string) => {
      if (table === "feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: existingFlag, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { ...existingFlag, ...values, updated_at: "now" },
                    error: null,
                  }),
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
    req: createRequest("POST", { action: "updateGlobalFlag", flagId: "flag-xyz", enabled: true }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { flag: { default_enabled: boolean } };
  assertEquals(body.flag.default_enabled, true);
  assertEquals(audits.length, 1);
  const auditRecord = audits[0] as { action: string; previous_state: unknown; new_state: unknown };
  assertEquals(auditRecord.action, "update_global_flag");
});

Deno.test("returns 404 when updating a non-existent global flag", async () => {
  const client = {
    from: (table: string) => {
      if (table === "feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", { action: "updateGlobalFlag", flagId: "missing-flag", enabled: true }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 404);
});

Deno.test("inserts organization flag override and writes audit logs", async () => {
  const inserts: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

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

      if (table === "feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { id: "flag-1", flag_key: "new-dashboard", default_enabled: false }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "organization_feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
          insert: (values: Record<string, unknown>) => {
            inserts.push(values);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "of-1",
                      organization_id: values.organization_id,
                      feature_flag_id: values.feature_flag_id,
                      is_enabled: values.is_enabled,
                      created_at: "now",
                      updated_at: "now",
                      created_by: values.created_by,
                      updated_by: values.updated_by,
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
    req: createRequest("POST", { action: "setOrgFlag", organizationId: "org-1", flagId: "flag-1", enabled: true }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { organizationFeatureFlag: { is_enabled: boolean } };
  assertEquals(body.organizationFeatureFlag.is_enabled, true);
  assertEquals(inserts.length > 0, true);
  assertEquals(audits.length, 1);
  const auditRecord = audits[0] as { action: string };
  assertEquals(auditRecord.action, "set_org_flag");
});

Deno.test("updates organization flag override and writes audit logs", async () => {
  const updates: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const existingOverride = {
    id: "of-2",
    organization_id: "org-1",
    feature_flag_id: "flag-1",
    is_enabled: false,
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

      if (table === "feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: "flag-1", flag_key: "new-dashboard" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "organization_feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: existingOverride, error: null }),
              }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...existingOverride, ...values, updated_at: "now" },
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
    req: createRequest("POST", { action: "setOrgFlag", organizationId: "org-1", flagId: "flag-1", enabled: true }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { organizationFeatureFlag: { is_enabled: boolean } };
  assertEquals(body.organizationFeatureFlag.is_enabled, true);
  assertEquals(updates.length, 1);
  assertEquals(audits.length, 1);
});

Deno.test("returns 404 when organization not found for setOrgFlag", async () => {
  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", { action: "setOrgFlag", organizationId: "missing-org", flagId: "flag-1", enabled: true }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 404);
});

Deno.test("assigns organization plan (insert) and writes audit logs", async () => {
  const inserts: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: "org-9", name: "Zen" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "plans") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { code: "professional" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "organization_plans") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: (values: Record<string, unknown>) => {
            inserts.push(values);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      organization_id: values.organization_id,
                      plan_code: values.plan_code,
                      assigned_at: "now",
                      assigned_by: values.assigned_by,
                      notes: values.notes ?? null,
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
    req: createRequest("POST", { action: "setOrgPlan", organizationId: "org-9", planCode: "professional", notes: "VIP" }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { organizationPlan: { plan_code: string; notes: string | null } };
  assertEquals(body.organizationPlan.plan_code, "professional");
  assertEquals(body.organizationPlan.notes, "VIP");
  assertEquals(inserts.length, 1);
  assertEquals(audits.length, 1);
});

Deno.test("updates organization plan and writes audit logs", async () => {
  const updates: Record<string, unknown>[] = [];
  const audits: unknown[] = [];

  const existing = {
    organization_id: "org-7",
    plan_code: "standard",
    assigned_at: "past",
    assigned_by: "admin-1",
    notes: "old",
  };

  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: "org-7", name: "Acme" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "plans") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { code: "enterprise" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "organization_plans") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: existing, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...existing, ...values },
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
    req: createRequest("POST", { action: "setOrgPlan", organizationId: "org-7", planCode: "enterprise" }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 200);
  const body = (await response.json()) as { organizationPlan: { plan_code: string } };
  assertEquals(body.organizationPlan.plan_code, "enterprise");
  assertEquals(updates.length, 1);
  assertEquals(audits.length, 1);
});

Deno.test("returns 404 when assigning a non-existent plan", async () => {
  const client = {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: "org-10", name: "Org" }, error: null }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (table === "plans") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table requested: ${table}`);
    },
  } as unknown as SupabaseClient;

  const response = await handleFeatureFlagAdmin({
    req: createRequest("POST", { action: "setOrgPlan", organizationId: "org-10", planCode: "unknown" }),
    userContext: createUserContext(),
    db: client,
  });

  assertEquals(response.status, 404);
});