/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  formatRedactedCaptureFailure,
  isExactLegacyCaptureUpsertRequest,
} from "../../scripts/playwright-bt-aba-session-note";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("BT ABA proof capture-response diagnostics", () => {
  it("uses exact deep links for closeout and calendar navigation only for the completed-card proof", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/playwright-bt-aba-session-note.ts"), "utf8");
    expect(source.match(/openScheduleSessionModalFromDeepLink\(/g)).toHaveLength(2);
    expect(source.match(/openScheduleSessionModalFromCalendar\(/g)).toHaveLength(1);
    expect(source.indexOf("await restored.waitFor({ state: \"hidden\" })"))
      .toBeLessThan(source.indexOf("openScheduleSessionModalFromCalendar("));
  });

  it("books the synthetic session inside the rendered Schedule grid timezone", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/playwright-bt-aba-session-note.ts"), "utf8");
    expect(source).toContain("resolveBrowserScheduleTimeZone(page!)");
    expect(source).toContain("buildInProgressSessionBookingBaseStart(new Date(), undefined, timeZone)");
    expect(source).toContain("buildVisibleScheduleBookingAttemptStart(base, attempt, timeZone)");
  });

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
