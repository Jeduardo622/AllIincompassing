import { beforeEach, describe, expect, it } from "vitest";
import { healthHandler } from "../api/health";
import { resetEnvCacheForTests } from "../env";

const originalEnv = { ...process.env };

describe("healthHandler", () => {
  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key-12345678901234567890";
    process.env.DEFAULT_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
    resetEnvCacheForTests();
  });

  it("returns ready when runtime config is available", async () => {
    const response = await healthHandler(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; readiness: string };
    expect(payload.status).toBe("ok");
    expect(payload.readiness).toBe("ready");
  });

  it("rejects disallowed origins", async () => {
    const response = await healthHandler(
      new Request("http://localhost/api/health", {
        headers: { Origin: "https://evil.example.com" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns not ready when runtime config is invalid", async () => {
    process.env.SUPABASE_ANON_KEY = "****";
    resetEnvCacheForTests();
    const response = await healthHandler(new Request("http://localhost/api/health"));
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { readiness: string };
    expect(payload.readiness).toBe("not_ready");
  });
});
