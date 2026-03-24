import { describe, expect, it } from "vitest";
import type { Therapist } from "../../../../types";
import {
  collectTherapistScopeCandidateIds,
  resolveScopedTherapistId,
} from "../sessionScope";

describe("sessionScope", () => {
  describe("collectTherapistScopeCandidateIds", () => {
    it("collects ids from profile, metadata, and preferences", () => {
      const candidates = collectTherapistScopeCandidateIds({
        profileId: " profile-id ",
        userMetadata: {
          therapist_id: " therapist-snake ",
          therapistId: "therapist-camel",
        },
        preferences: {
          therapist_id: "pref-snake",
          therapistId: " pref-camel ",
        },
      });

      expect(Array.from(candidates)).toEqual([
        "profile-id",
        "therapist-snake",
        "therapist-camel",
        "pref-snake",
        "pref-camel",
      ]);
    });

    it("deduplicates values and ignores invalid entries", () => {
      const candidates = collectTherapistScopeCandidateIds({
        profileId: "same-id",
        userMetadata: {
          therapist_id: "same-id",
          therapistId: "   ",
        },
        preferences: {
          therapist_id: 123,
          therapistId: "same-id",
        },
      });

      expect(Array.from(candidates)).toEqual(["same-id"]);
    });
  });

  describe("resolveScopedTherapistId", () => {
    const therapists = [
      { id: "t-1", full_name: "Therapist One" },
      { id: "t-2", full_name: "Therapist Two" },
    ] as Therapist[];

    it("returns the matched therapist id", () => {
      const resolved = resolveScopedTherapistId(therapists, ["other", "t-2"]);
      expect(resolved).toBe("t-2");
    });

    it("returns null when no therapist matches", () => {
      const resolved = resolveScopedTherapistId(therapists, ["missing"]);
      expect(resolved).toBeNull();
    });
  });
});
