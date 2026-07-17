/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  formatRedactedCaptureFailure,
  isExactLegacyCaptureUpsertRequest,
} from "../../scripts/playwright-bt-aba-session-note";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("BT ABA proof capture-response diagnostics", () => {
  it("matches only the exact legacy capture POST for the created session", () => {
    const payload = JSON.stringify({ sessionId: SESSION_ID, clientId: "22222222-2222-4222-8222-222222222222" });
    expect(isExactLegacyCaptureUpsertRequest("http://127.0.0.1:4173/api/session-notes/upsert", "POST", payload, SESSION_ID)).toBe(true);
    expect(isExactLegacyCaptureUpsertRequest("http://127.0.0.1:4173/api/session-notes/upsert", "GET", payload, SESSION_ID)).toBe(false);
    expect(isExactLegacyCaptureUpsertRequest("http://127.0.0.1:4173/api/session-notes/upsert", "POST", JSON.stringify({ action: "draft_bt_aba", sessionId: SESSION_ID }), SESSION_ID)).toBe(false);
    expect(isExactLegacyCaptureUpsertRequest("http://127.0.0.1:4173/api/session-notes/upsert", "POST", payload, "33333333-3333-4333-8333-333333333333")).toBe(false);
  });

  it("reports only redacted status, code, and message", () => {
    const result = formatRedactedCaptureFailure(403, JSON.stringify({
      code: "forbidden",
      message: `Denied ${SESSION_ID} for user@example.com with eyJhbGciOiJIUzI1NiJ9.payload.signature`,
      requestId: "44444444-4444-4444-8444-444444444444",
      payload: { password: "should-never-appear" },
    }));
    expect(result).toContain("status=403");
    expect(result).toContain("code=forbidden");
    expect(result).toContain("message=Denied [uuid] for [email] with [token]");
    expect(result).not.toContain(SESSION_ID);
    expect(result).not.toContain("user@example.com");
    expect(result).not.toContain("should-never-appear");
    expect(result).not.toContain("requestId");
  });
});
