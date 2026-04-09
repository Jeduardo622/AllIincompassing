import { describe, expect, it } from "vitest";

import { corsHeadersForOrigin, resolveAllowedOriginValue } from "../corsPolicy";

describe("corsPolicy", () => {
  it("includes apikey and x-supabase-authorization for preflight on /api/dashboard-style requests", () => {
    const allow = corsHeadersForOrigin(null)["Access-Control-Allow-Headers"];
    expect(allow).toContain("apikey");
    expect(allow).toContain("x-supabase-authorization");
  });

  it("allows project Netlify deploy-preview origins", () => {
    const origin = "https://deploy-preview-362--velvety-cendol-dae4d6.netlify.app";
    expect(resolveAllowedOriginValue(origin)).toBe(origin);
  });

  it("rejects untrusted netlify origins", () => {
    expect(resolveAllowedOriginValue("https://deploy-preview-362--attacker.netlify.app")).toBeNull();
  });
});
