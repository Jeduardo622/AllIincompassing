import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { createHandler } from "./index.ts";

const FUNCTION_URL =
  "https://wnnjeqheqxxyrgsjmygy.supabase.co/functions/v1/feature-flags-v2";

const createPreflightRequest = (origin: string, requestedMethod = "POST") =>
  new Request(FUNCTION_URL, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": requestedMethod,
      "Access-Control-Request-Headers": "authorization,apikey",
    },
  });

Deno.test("OPTIONS preflight does not load the feature flags application", async () => {
  let applicationLoads = 0;
  const handler = createHandler(async () => {
    applicationLoads += 1;
    throw new Error("application loader must not run for preflight");
  });

  const response = await handler(
    createPreflightRequest("https://app.allincompassing.ai"),
  );

  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.allincompassing.ai",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization,apikey",
  );
  assertEquals(applicationLoads, 0);
});

Deno.test("GET preflight uses the runtime CORS contract without loading the application", async () => {
  const handler = createHandler(async () => {
    throw new Error("application loader must not run for preflight");
  });

  const response = await handler(
    createPreflightRequest("https://app.allincompassing.ai", "GET"),
  );

  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.allincompassing.ai",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, OPTIONS",
  );
});

Deno.test("OPTIONS preflight rejects disallowed origins without loading the application", async () => {
  const handler = createHandler(async () => {
    throw new Error("application loader must not run for preflight");
  });

  const response = await handler(
    createPreflightRequest("https://malicious.example.com"),
  );

  assertEquals(response.status, 403);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.allincompassing.ai",
  );
  assertEquals(await response.json(), { error: "Origin not allowed" });
});

Deno.test("non-OPTIONS requests load and delegate to the feature flags application", async () => {
  let applicationLoads = 0;
  const handler = createHandler(async () => {
    applicationLoads += 1;
    return {
      handler: async (req: Request) =>
        new Response(JSON.stringify({ method: req.method }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
    };
  });

  const response = await handler(new Request(FUNCTION_URL, { method: "POST" }));

  assertEquals(response.status, 202);
  assertEquals(await response.json(), { method: "POST" });
  assertEquals(applicationLoads, 1);
});
