import { afterEach, describe, expect, it } from "vitest";

import {
  buildSafeApiProofEntry,
  getPlaywrightMobileContextOptions,
  shouldUseMobilePlaywrightContext,
} from "../../scripts/lib/playwright-mobile-proof";

const originalMobileContext = process.env.PW_MOBILE_CONTEXT;

describe("playwright mobile proof helpers", () => {
  afterEach(() => {
    if (originalMobileContext === undefined) {
      delete process.env.PW_MOBILE_CONTEXT;
      return;
    }
    process.env.PW_MOBILE_CONTEXT = originalMobileContext;
  });

  it("enables the iPhone 13 mobile context only when the env flag is truthy", () => {
    delete process.env.PW_MOBILE_CONTEXT;
    expect(shouldUseMobilePlaywrightContext()).toBe(false);

    process.env.PW_MOBILE_CONTEXT = "true";
    expect(shouldUseMobilePlaywrightContext()).toBe(true);

    const options = getPlaywrightMobileContextOptions();
    expect(options.viewport).toEqual({ width: 390, height: 844 });
    expect(options.isMobile).toBe(true);
    expect(options.hasTouch).toBe(true);
    expect(options.userAgent).toContain("iPhone");
  });

  it("records only method, pathname, status, and timestamp for exact proof endpoints", () => {
    expect(buildSafeApiProofEntry({
      method: "post",
      url: "https://app.example.com/api/session-notes/upsert?session_id=secret&client=phi",
      status: 200,
      timestamp: "2026-08-07T00:00:00.000Z",
    })).toEqual({
      method: "POST",
      pathname: "/api/session-notes/upsert",
      status: 200,
      timestamp: "2026-08-07T00:00:00.000Z",
    });

    expect(buildSafeApiProofEntry({
      method: "POST",
      url: "https://app.example.com/api/sessions-complete?id=1234",
      status: 409,
      timestamp: "2026-08-07T00:01:00.000Z",
    })).toEqual({
      method: "POST",
      pathname: "/api/sessions-complete",
      status: 409,
      timestamp: "2026-08-07T00:01:00.000Z",
    });
  });

  it("rejects non-proof endpoints so no extra request data is serialized", () => {
    expect(buildSafeApiProofEntry({
      method: "POST",
      url: "https://app.example.com/api/session-notes/upsert-extra?client=phi",
      status: 200,
      timestamp: "2026-08-07T00:00:00.000Z",
    })).toBeNull();

    expect(buildSafeApiProofEntry({
      method: "GET",
      url: "https://app.example.com/schedule?client=phi",
      status: 200,
      timestamp: "2026-08-07T00:00:00.000Z",
    })).toBeNull();
  });
});
