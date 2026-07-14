import { describe, expect, it } from "vitest";
import { buildLiveRlsAppMetadata } from "./_helpers/liveRlsHarness.ts";

describe("live RLS harness actor metadata", () => {
  it("marks the actor as an expiring service-created fixture", () => {
    const before = Date.now();
    const metadata = buildLiveRlsAppMetadata();
    expect(metadata.ci_rls_fixture).toBe(true);
    expect(new Date(metadata.ci_rls_expires_at).getTime()).toBeGreaterThan(before);
    expect(new Date(metadata.ci_rls_expires_at).getTime()).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 1000);
  });
});
