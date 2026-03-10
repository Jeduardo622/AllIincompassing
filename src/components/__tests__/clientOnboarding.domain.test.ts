import { describe, expect, it } from "vitest";
import { buildAvailableCodesByProvider } from "../clientOnboarding.domain";
import { UNIVERSAL_CPT_CODE } from "../clientOnboarding.constants";

describe("buildAvailableCodesByProvider", () => {
  it("maps provider-specific and universal codes deterministically", () => {
    const result = buildAvailableCodesByProvider([
      { code: "h0032", short_description: "H code" },
      { code: "97151", short_description: "Private code" },
      { code: "h0032", short_description: "Duplicate should be ignored" },
      { code: "T1024", short_description: "Universal override" },
    ]);

    expect(result.Private.some((row) => row.code === "97151")).toBe(true);
    expect(result.Private.some((row) => row.code === "H0032")).toBe(false);

    expect(result.IEHP.some((row) => row.code === "H0032")).toBe(true);
    expect(result.CalOptima.some((row) => row.code === "H0032")).toBe(true);

    expect(result.Private.filter((row) => row.code === UNIVERSAL_CPT_CODE)).toHaveLength(1);
    expect(result.IEHP.filter((row) => row.code === UNIVERSAL_CPT_CODE)).toHaveLength(1);
    expect(result.CalOptima.filter((row) => row.code === UNIVERSAL_CPT_CODE)).toHaveLength(1);
  });
});
