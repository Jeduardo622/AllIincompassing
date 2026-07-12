import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { assertRouteAccessible } from "../../scripts/lib/playwright-smoke";

describe("assertRouteAccessible readiness", () => {
  const buildPage = (waitFor: ReturnType<typeof vi.fn>): Page => ({
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    locator: vi.fn().mockReturnValue({
      first: vi.fn().mockReturnValue({ waitFor }),
    }),
  } as unknown as Page);

  it("waits for a delayed route readiness selector using the configured timeout", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page = buildPage(waitFor);

    await assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 30_000,
    });

    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 30_000 });
  });

  it("retries the expected route when readiness appears after the first bounded wait", async () => {
    const waitFor = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(undefined);
    const page = buildPage(waitFor);

    await assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    });

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(waitFor).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the readiness selector stays absent", async () => {
    const waitFor = vi.fn().mockRejectedValue(new Error("timeout"));
    const page = buildPage(waitFor);

    await expect(assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    })).rejects.toThrow('readiness selector was not visible: button[aria-label="Day view"]');

    expect(page.goto).toHaveBeenCalledTimes(3);
    expect(waitFor).toHaveBeenCalledTimes(3);
  });
});
