import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { assertAgentWorkSupabaseUrl } from "./runtime-url.ts";

Deno.test("runtime URL accepts loopback origins, the exact Phase 2 Kong origin, and an explicit hosted project ref", () => {
  assertEquals(
    assertAgentWorkSupabaseUrl("http://127.0.0.1:54321"),
    "http://127.0.0.1:54321",
  );
  assertEquals(
    assertAgentWorkSupabaseUrl("http://localhost:54321"),
    "http://localhost:54321",
  );
  assertEquals(
    assertAgentWorkSupabaseUrl("http://SUPABASE_KONG_AllIincompassing:8000", {
      phase2Container: true,
    }),
    "http://supabase_kong_alliincompassing:8000",
  );
  assertEquals(
    assertAgentWorkSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co", {
      hostedProjectRef: "abcdefghijklmnopqrst",
    }),
    "https://abcdefghijklmnopqrst.supabase.co",
  );
});

Deno.test("runtime URL rejects malformed or mismatched hosted values without echoing sensitive input", () => {
  const cases = [
    ["https://abcdefghijklmnopqrst.supabase.co", {}],
    ["https://abcdefghijklmnopqrs.supabase.co", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co", { hostedProjectRef: "ABCdefghijklmnopqrst" }],
    ["http://abcdefghijklmnopqrst.supabase.co", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co:8443", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://user@abcdefghijklmnopqrst.supabase.co", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co/path", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co?query=1", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co#fragment", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.example.com", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://abcdefghijklmnopqrst.supabase.co.evil.example", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["https://host.docker.internal:54321", { hostedProjectRef: "abcdefghijklmnopqrst" }],
    ["not-a-url", { hostedProjectRef: "abcdefghijklmnopqrst" }],
  ] as const;

  for (const [value, options] of cases) {
    const error = assertThrows(() => assertAgentWorkSupabaseUrl(value, options)) as Error;
    assertEquals(error.message.includes(value), false, value);
    if ("hostedProjectRef" in options && typeof options.hostedProjectRef === "string") {
      assertEquals(error.message.includes(options.hostedProjectRef), false, options.hostedProjectRef);
    }
  }
});
