import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  isAgentWorkServiceRequestAuthorized,
  resolveAgentWorkGatewayApiKeys,
} from "./service-auth.ts";

Deno.test("gateway key resolution supports named publishable keys and local fallbacks", () => {
  assertEquals(resolveAgentWorkGatewayApiKeys({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "publishable-default" }),
    SUPABASE_PUBLISHABLE_KEY: "publishable-local",
    SUPABASE_ANON_KEY: "legacy-anon",
  }), ["publishable-default", "publishable-local", "legacy-anon"]);
  assertEquals(resolveAgentWorkGatewayApiKeys({ SUPABASE_ANON_KEY: "legacy-anon" }), [
    "legacy-anon",
  ]);
});

Deno.test("gateway key resolution fails closed for missing or malformed configuration", () => {
  assertEquals(resolveAgentWorkGatewayApiKeys({}), []);
  assertEquals(resolveAgentWorkGatewayApiKeys({
    SUPABASE_PUBLISHABLE_KEYS: "not-json",
    SUPABASE_ANON_KEY: "legacy-anon",
  }), []);
});

Deno.test("service request auth requires apikey plus the endpoint secret and rejects bearer-only input", () => {
  const authorized = new Request("http://localhost/worker", {
    headers: { apikey: "publishable", "x-worker-secret": "worker-secret" },
  });
  assertEquals(isAgentWorkServiceRequestAuthorized(
    authorized,
    "x-worker-secret",
    "worker-secret",
    ["publishable"],
  ), true);

  const bearerOnly = new Request("http://localhost/worker", {
    headers: {
      Authorization: "Bearer service-role",
      "x-worker-secret": "worker-secret",
    },
  });
  assertEquals(isAgentWorkServiceRequestAuthorized(
    bearerOnly,
    "x-worker-secret",
    "worker-secret",
    ["publishable"],
  ), false);
});
