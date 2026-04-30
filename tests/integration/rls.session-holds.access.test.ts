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

describe("RLS session_holds + scoped session access (live Supabase)", () => {
  it("returns only same-org session_holds to org-a admin", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const { data, error } = await orgAClient
      .from("session_holds")
      .select("id, organization_id")
      .in("id", [harness.orgA.sessionHoldId, harness.orgB.sessionHoldId]);

    expect(error).toBeNull();
    expect((data ?? []).every((hold) => hold.organization_id === harness.orgAId)).toBe(true);
    expect((data ?? []).map((hold) => hold.id)).toContain(harness.orgA.sessionHoldId);
    expect((data ?? []).map((hold) => hold.id)).not.toContain(harness.orgB.sessionHoldId);
  });

  it("prevents org-a admin from deleting org-b session_holds", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const deleteResult = await orgAClient
      .from("session_holds")
      .delete()
      .eq("id", harness.orgB.sessionHoldId)
      .select("id");

    if (deleteResult.error) {
      expect(deleteResult.error.message.toLowerCase()).toMatch(/row-level security|permission|not allowed|violat/);
      return;
    }

    expect(deleteResult.data ?? []).toHaveLength(0);
  });

  it("limits therapist-scoped reads to their own sessions and holds", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const therapistClient = await harness.signInTherapistA();
    const sessionResult = await therapistClient
      .from("sessions")
      .select("id, therapist_id, organization_id")
      .in("id", [harness.orgA.sessionId, harness.orgB.sessionId]);
    const holdResult = await therapistClient
      .from("session_holds")
      .select("id, therapist_id, organization_id")
      .in("id", [harness.orgA.sessionHoldId, harness.orgB.sessionHoldId]);

    expect(sessionResult.error).toBeNull();
    expect(holdResult.error).toBeNull();
    expect((sessionResult.data ?? []).map((row) => row.id)).toEqual([harness.orgA.sessionId]);
    expect((holdResult.data ?? []).map((row) => row.id)).toEqual([harness.orgA.sessionHoldId]);
    expect((sessionResult.data ?? [])[0]?.therapist_id).toBe(harness.orgATherapistUserId);
    expect((holdResult.data ?? [])[0]?.therapist_id).toBe(harness.orgATherapistUserId);
  });

  it("fails closed when the caller has no org context", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const outsiderClient = await harness.signInOutsider();
    const sessionResult = await outsiderClient
      .from("sessions")
      .select("id")
      .in("id", [harness.orgA.sessionId, harness.orgB.sessionId]);
    const holdResult = await outsiderClient
      .from("session_holds")
      .select("id")
      .in("id", [harness.orgA.sessionHoldId, harness.orgB.sessionHoldId]);

    if (sessionResult.error) {
      expect(sessionResult.error.message.toLowerCase()).toMatch(/row-level security|permission|not allowed|violat/);
    } else {
      expect(sessionResult.data ?? []).toHaveLength(0);
    }

    if (holdResult.error) {
      expect(holdResult.error.message.toLowerCase()).toMatch(/row-level security|permission|not allowed|violat/);
    } else {
      expect(holdResult.data ?? []).toHaveLength(0);
    }
  });
});
