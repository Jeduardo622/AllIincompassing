import { afterEach, describe, expect, it } from "vitest";

import {
  loadMultiOrgSeed,
  registerMultiOrgSeedLoader,
  resetMultiOrgSeedLoader,
} from "./multiOrgSeed.ts";

const ORIGINAL_SEED_MODE = process.env.INTEGRATION_SEED_MODE;

afterEach(() => {
  resetMultiOrgSeedLoader();
  if (ORIGINAL_SEED_MODE === undefined) {
    delete process.env.INTEGRATION_SEED_MODE;
    return;
  }
  process.env.INTEGRATION_SEED_MODE = ORIGINAL_SEED_MODE;
});

describe("loadMultiOrgSeed", () => {
  it("returns fixture seed by default", async () => {
    delete process.env.INTEGRATION_SEED_MODE;

    const result = await loadMultiOrgSeed();

    expect(result.source).toBe("fixture");
    expect(result.seed.organizationId).toBe("org-a");
    expect(result.warnings).toEqual([]);
  });

  it("falls back to fixture seed with warning when MCP mode is requested without a loader", async () => {
    process.env.INTEGRATION_SEED_MODE = "mcp";

    const result = await loadMultiOrgSeed();

    expect(result.source).toBe("fixture");
    expect(result.warnings).toHaveLength(1);
  });

  it("uses registered MCP loader when MCP mode is enabled", async () => {
    process.env.INTEGRATION_SEED_MODE = "mcp";

    registerMultiOrgSeedLoader(() => ({
      organizationId: "org-x",
      sessions: [],
      therapists: [],
      clients: [],
      billingRecords: [],
    }));

    const result = await loadMultiOrgSeed();

    expect(result.source).toBe("mcp");
    expect(result.seed.organizationId).toBe("org-x");
    expect(result.warnings).toEqual([]);
  });
});
