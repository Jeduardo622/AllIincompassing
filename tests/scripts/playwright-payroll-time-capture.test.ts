// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runPayrollTimeCaptureProof } from "../../scripts/playwright-payroll-time-capture";

describe("playwright payroll time capture proof", () => {
  it("keeps the proof loopback-only and machine-safe", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts", "playwright-payroll-time-capture.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/dotenv|load-playwright-env|https:\/\//i);
    expect(source).toContain('chromium.launch({ headless: true })');
    expect(source).toContain('"127.0.0.1"');
    expect(source).toContain('"Idempotency-Key"');
  });

  it("proves native IndexedDB payroll outbox replay across offline and reconnect", async () => {
    const summary = await runPayrollTimeCaptureProof();

    expect(summary).toEqual({
      ok: true,
      baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      queuedBeforeReconnect: 2,
      queuedAfterReconnect: 0,
      confirmedKeys: ["time-proof-key-1", "attendance-proof-key-1"],
      requestLog: [
        {
          method: "POST",
          pathname: "/api/payroll-time-events",
          action: "record_time_event",
          idempotencyKey: "time-proof-key-1",
        },
        {
          method: "POST",
          pathname: "/api/payroll-time-events",
          action: "record_session_attendance",
          idempotencyKey: "attendance-proof-key-1",
        },
      ],
    });
  }, 60_000);
});
