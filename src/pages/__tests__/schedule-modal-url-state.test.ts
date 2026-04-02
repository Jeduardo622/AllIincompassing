import { describe, expect, it } from "vitest";
import {
  applyScheduleModalSearchParams,
  clearScheduleModalSearchParams,
  parseScheduleModalSearchParams,
} from "../schedule-modal-url-state";

describe("schedule modal url state", () => {
  it("parses valid create state", () => {
    const params = new URLSearchParams();
    const next = applyScheduleModalSearchParams(params, {
      mode: "create",
      startTimeIso: "2025-03-18T10:00:00.000Z",
      expiresAtMs: 1000,
    });

    expect(parseScheduleModalSearchParams(next, 999)).toEqual({
      kind: "ready",
      key: "create|2025-03-18T10:00:00.000Z|1000",
      state: {
        mode: "create",
        startTimeIso: "2025-03-18T10:00:00.000Z",
        expiresAtMs: 1000,
      },
    });
  });

  it("treats expired state as expired", () => {
    const params = new URLSearchParams(
      "scheduleModal=create&scheduleStart=2025-03-18T10:00:00.000Z&scheduleExp=1000",
    );
    expect(parseScheduleModalSearchParams(params, 1000)).toEqual({
      kind: "expired",
    });
  });

  it("parses valid edit state", () => {
    const params = applyScheduleModalSearchParams(new URLSearchParams(), {
      mode: "edit",
      sessionId: "session-123",
      expiresAtMs: 10_000,
    });
    expect(parseScheduleModalSearchParams(params, 9_999)).toEqual({
      kind: "ready",
      key: "edit|session-123|10000",
      state: {
        mode: "edit",
        sessionId: "session-123",
        expiresAtMs: 10_000,
      },
    });
  });

  it("marks malformed modal params as invalid", () => {
    const params = new URLSearchParams("scheduleModal=create&scheduleExp=2000");
    expect(parseScheduleModalSearchParams(params, 1000)).toEqual({
      kind: "invalid",
    });
  });

  it("clears modal-specific keys only", () => {
    const params = new URLSearchParams(
      "foo=1&scheduleModal=edit&scheduleSessionId=session-1&scheduleExp=9999",
    );
    const next = clearScheduleModalSearchParams(params);
    expect(next.toString()).toBe("foo=1");
  });
});
