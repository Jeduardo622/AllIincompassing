import { describe, it, expect } from "vitest";
import { sessionSchema } from "../validationSchemas";

const baseSession = {
  client_id: "client-1",
  therapist_id: "therapist-1",
  session_date: "2026-03-31",
  start_time: "09:00",
  end_time: "10:00",
  session_type: "Individual" as const,
};

describe("sessionSchema status field", () => {
  it("accepts in_progress as a valid status", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "in_progress" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("in_progress");
    }
  });

  it("accepts scheduled as a valid status", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "scheduled" });
    expect(result.success).toBe(true);
  });

  it("accepts completed as a valid status", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "completed" });
    expect(result.success).toBe(true);
  });

  it("accepts cancelled as a valid status", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "cancelled" });
    expect(result.success).toBe(true);
  });

  it("accepts no-show as a valid status", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "no-show" });
    expect(result.success).toBe(true);
  });

  it("defaults to scheduled when status is omitted", () => {
    const result = sessionSchema.safeParse({ ...baseSession });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("scheduled");
    }
  });

  it("rejects an unknown status value", () => {
    const result = sessionSchema.safeParse({ ...baseSession, status: "pending" });
    expect(result.success).toBe(false);
  });
});
