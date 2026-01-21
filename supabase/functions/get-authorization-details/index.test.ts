import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { handleGetAuthorizationDetails } from "./index.ts";
import type { UserContext } from "../_shared/auth-middleware.ts";

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/get-authorization-details", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function createUserContext(): UserContext {
  return {
    user: { id: "admin-1", email: "admin@example.com" },
    profile: { id: "admin-1", email: "admin@example.com", role: "admin", is_active: true },
  };
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
  const response = await handleGetAuthorizationDetails({
    req: createRequest({ authorizationId: "auth-1" }),
    userContext: createUserContext(),
    db: createMockClient(),
  });

  const payload = await response.json();
  assertEquals(response.status, 403);
  assertEquals(payload.error, "Organization context required");
});
