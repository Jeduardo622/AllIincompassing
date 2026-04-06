import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { __TESTING__, handleGetDashboardData } from "./index.ts";

function createRequest() {
  return new Request("http://localhost/get-dashboard-data", {
    method: "GET",
    headers: { "x-request-id": "req-1" },
  });
}

function createMockClient(): SupabaseClient {
  return {
    rpc: async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => {
      throw new Error("Unexpected query call");
    },
  } as unknown as SupabaseClient;
}

Deno.test("returns 403 when organization context is missing", async () => {
  const response = await handleGetDashboardData({
    req: createRequest(),
    db: createMockClient(),
  });

  const payload = await response.json();
  assertEquals(response.status, 403);
  assertEquals(payload.code, "missing_org");
});

Deno.test("resolveDashboardOrganizationId returns resolved org when present", async () => {
  const db = {
    rpc: async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: "org-from-profile", error: null };
      }
      return { data: false, error: null };
    },
  } as unknown as SupabaseClient;

  const result = await __TESTING__.resolveDashboardOrganizationId(db);
  assertEquals(result, "org-from-profile");
});

Deno.test("resolveDashboardOrganizationId falls back to DEFAULT_ORGANIZATION_ID for super admin", async () => {
  const previous = Deno.env.get("DEFAULT_ORGANIZATION_ID");
  Deno.env.set("DEFAULT_ORGANIZATION_ID", "org-default");

  try {
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") {
          return { data: null, error: null };
        }
        if (fn === "current_user_is_super_admin") {
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    } as unknown as SupabaseClient;

    const result = await __TESTING__.resolveDashboardOrganizationId(db);
    assertEquals(result, "org-default");
  } finally {
    if (typeof previous === "string") {
      Deno.env.set("DEFAULT_ORGANIZATION_ID", previous);
    } else {
      Deno.env.delete("DEFAULT_ORGANIZATION_ID");
    }
  }
});

Deno.test("resolveDashboardOrganizationId prefers super admin metadata organization", async () => {
  const db = {
    rpc: async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: null, error: null };
      }
      if (fn === "current_user_is_super_admin") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "user-1",
            user_metadata: { organization_id: "org-metadata" },
          },
        },
        error: null,
      }),
    },
    from: () => {
      throw new Error("Profile lookup should not run when metadata provides organization");
    },
  } as unknown as SupabaseClient;

  const result = await __TESTING__.resolveDashboardOrganizationId(db);
  assertEquals(result, "org-metadata");
});

Deno.test("resolveDashboardOrganizationId throws when org is missing and user is not super admin", async () => {
  const db = {
    rpc: async (fn: string) => {
      if (fn === "current_user_organization_id") {
        return { data: null, error: null };
      }
      if (fn === "current_user_is_super_admin") {
        return { data: false, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;

  await assertRejects(
    () => __TESTING__.resolveDashboardOrganizationId(db),
    Error,
    "Organization context required",
  );
});
