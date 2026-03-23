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

describe("RLS sessions read/write (live Supabase)", () => {
  it("returns only same-org sessions to org-a member", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const { data, error } = await orgAClient
      .from("sessions")
      .select("id, organization_id")
      .in("id", [harness.orgA.sessionId, harness.orgB.sessionId]);

    expect(error).toBeNull();
    expect((data ?? []).every(session => session.organization_id === harness.orgAId)).toBe(true);
    expect((data ?? []).map(session => session.id)).toContain(harness.orgA.sessionId);
    expect((data ?? []).map(session => session.id)).not.toContain(harness.orgB.sessionId);
  });

  it("prevents org-a admin from updating org-b session", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const updateResult = await orgAClient
      .from("sessions")
      .update({ notes: "cross-org attempt should fail" })
      .eq("id", harness.orgB.sessionId)
      .select("id");

    if (updateResult.error) {
      expect(updateResult.error.message.toLowerCase()).toMatch(/row-level security|permission|not allowed|violat/);
      return;
    }

    expect(updateResult.data ?? []).toHaveLength(0);
  });
});
