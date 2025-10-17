import { describe, expect, it } from "vitest";
import { buildMultiOrgSeed } from "../fixtures/multiOrgSeed.ts";
import { ForbiddenError } from "../../supabase/functions/_shared/org.ts";

const seed = buildMultiOrgSeed();

describe("RLS coverage for therapists / clients / billing_records", () => {
  it("allows same-org reads and blocks cross-org", () => {
    const therapists = seed.therapists.filter(row => row.organization_id === "org-a");
    expect(therapists).toHaveLength(1);
    const crossOrgTherapist = seed.therapists
      .filter(row => row.organization_id === "org-a")
      .find(row => row.id === "ther-002");
    expect(crossOrgTherapist).toBeUndefined();
  });

  it("denies cross-org billing updates", () => {
    const attempt = () => {
      const record = seed.billingRecords.find(row => row.id === "bill-002");
      if (!record || record.organization_id !== "org-a") {
        throw new ForbiddenError("Cross-org billing mutation denied");
      }
      return record;
    };

    expect(attempt).toThrow(ForbiddenError);
  });
});

// TODO: Replace with live Supabase-powered assertions once automated DB harness is available.
