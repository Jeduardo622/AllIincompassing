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

  it("retries readiness on the same document when it appears after the first bounded wait", async () => {
    const waitFor = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(undefined);
    const page = buildPage(waitFor);

    await assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    });

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(waitFor).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the readiness selector stays absent", async () => {
    const waitFor = vi.fn().mockRejectedValue(new Error("timeout"));
    const page = buildPage(waitFor);

    await expect(assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    })).rejects.toThrow('readiness selector was not visible: button[aria-label="Day view"]');

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(waitFor).toHaveBeenCalledTimes(3);
  });

  it("retries navigation after unauthorized hydration and then checks readiness", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page = buildPage(waitFor);
    vi.mocked(page.url)
      .mockReturnValueOnce("https://app.example.com/unauthorized")
      .mockReturnValueOnce("https://app.example.com/schedule");
    page.waitForTimeout = vi.fn().mockResolvedValue(undefined);

    await assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    });

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledWith(1500);
    expect(waitFor).toHaveBeenCalledTimes(1);
  });

  it("bounds persistent unauthorized retries and fails closed", async () => {
    const waitFor = vi.fn();
    const page = buildPage(waitFor);
    vi.mocked(page.url).mockReturnValue("https://app.example.com/unauthorized");
    page.waitForTimeout = vi.fn().mockResolvedValue(undefined);

    await expect(assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
      timeoutMs: 100,
    })).rejects.toThrow("Authenticated user cannot access required route /schedule");

    expect(page.goto).toHaveBeenCalledTimes(3);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
    expect(waitFor).not.toHaveBeenCalled();
  });

  it("fails a login redirect immediately without retrying navigation", async () => {
    const waitFor = vi.fn();
    const page = buildPage(waitFor);
    vi.mocked(page.url).mockReturnValue("https://app.example.com/login");
    page.waitForTimeout = vi.fn().mockResolvedValue(undefined);

    await expect(assertRouteAccessible(page, "https://app.example.com", "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
    })).rejects.toThrow("Authenticated user cannot access required route /schedule");

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(waitFor).not.toHaveBeenCalled();
  });
});
