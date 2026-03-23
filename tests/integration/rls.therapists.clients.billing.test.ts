import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupLiveRlsHarness, type LiveRlsHarness } from "./_helpers/liveRlsHarness.ts";

let harness: LiveRlsHarness = {
  enabled: false,
  required: false,
  skipReason: "Harness not initialized.",
};

beforeAll(async () => {
  harness = await setupLiveRlsHarness();
});

afterAll(async () => {
  if (harness.enabled) {
    await harness.cleanup();
  }
});

describe("RLS coverage for therapists / clients / billing_records (live Supabase)", () => {
  it("allows same-org reads and blocks cross-org therapist/client visibility", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const therapistResult = await orgAClient
      .from("therapists")
      .select("id, organization_id")
      .in("id", [harness.orgA.therapistId, harness.orgB.therapistId]);
    const clientResult = await orgAClient
      .from("clients")
      .select("id, organization_id")
      .in("id", [harness.orgA.clientId, harness.orgB.clientId]);

    expect(therapistResult.error).toBeNull();
    expect(clientResult.error).toBeNull();
    expect((therapistResult.data ?? []).map(row => row.id)).toContain(harness.orgA.therapistId);
    expect((therapistResult.data ?? []).map(row => row.id)).not.toContain(harness.orgB.therapistId);
    expect((clientResult.data ?? []).map(row => row.id)).toContain(harness.orgA.clientId);
    expect((clientResult.data ?? []).map(row => row.id)).not.toContain(harness.orgB.clientId);
  });

  it("denies cross-org billing updates", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const updateResult = await orgAClient
      .from("billing_records")
      .update({ status: "paid" })
      .eq("id", harness.orgB.billingRecordId)
      .select("id");

    if (updateResult.error) {
      expect(updateResult.error.message.toLowerCase()).toMatch(/row-level security|permission|not allowed|violat/);
      return;
    }

    expect(updateResult.data ?? []).toHaveLength(0);
  });
});
