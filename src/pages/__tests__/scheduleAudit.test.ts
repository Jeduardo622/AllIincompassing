import { describe, expect, it } from "vitest";
import { sanitizeAuditActorId, stampAuditMetadata } from "../scheduleAudit";

describe("sanitizeAuditActorId", () => {
  it("returns trimmed identifier when valid", () => {
    expect(sanitizeAuditActorId("  user-123  ")).toBe("user-123");
  });

  it("returns null for missing or blank identifiers", () => {
    expect(sanitizeAuditActorId(null)).toBeNull();
    expect(sanitizeAuditActorId("   ")).toBeNull();
  });
});

describe("stampAuditMetadata", () => {
  it("fills missing audit fields using the provided actor", () => {
    const timestamp = new Date("2025-01-01T00:00:00Z");
    const result = stampAuditMetadata({}, "user-1", timestamp);
    expect(result.created_at).toBe(timestamp.toISOString());
    expect(result.created_by).toBe("user-1");
    expect(result.updated_at).toBe(timestamp.toISOString());
    expect(result.updated_by).toBe("user-1");
  });

  it("preserves existing created metadata and updates modifier", () => {
    const timestamp = new Date("2025-02-02T00:00:00Z");
    const result = stampAuditMetadata(
      {
        created_at: "2025-01-01T00:00:00Z",
        created_by: "creator",
        updated_by: "other",
      },
      "editor",
      timestamp,
    );
    expect(result.created_at).toBe("2025-01-01T00:00:00Z");
    expect(result.created_by).toBe("creator");
    expect(result.updated_at).toBe(timestamp.toISOString());
    expect(result.updated_by).toBe("editor");
  });

  it("retains existing updater when actor is unavailable", () => {
    const timestamp = new Date("2025-03-03T00:00:00Z");
    const result = stampAuditMetadata(
      {
        created_at: "2025-01-01T00:00:00Z",
        created_by: "creator",
        updated_by: "previous",
      },
      null,
      timestamp,
    );
    expect(result.created_by).toBe("creator");
    expect(result.updated_by).toBe("previous");
    expect(result.updated_at).toBe(timestamp.toISOString());
  });
});
