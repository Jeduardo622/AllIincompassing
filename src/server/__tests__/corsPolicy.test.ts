import { describe, expect, it } from "vitest";

import { resolveAllowedOriginValue } from "../corsPolicy";

describe("corsPolicy", () => {
  it("allows project Netlify deploy-preview origins", () => {
    const origin = "https://deploy-preview-362--velvety-cendol-dae4d6.netlify.app";
    expect(resolveAllowedOriginValue(origin)).toBe(origin);
  });

  it("rejects untrusted netlify origins", () => {
    expect(resolveAllowedOriginValue("https://deploy-preview-362--attacker.netlify.app")).toBeNull();
  });
});
