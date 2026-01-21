import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleGetDashboardData } from "./index.ts";

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
