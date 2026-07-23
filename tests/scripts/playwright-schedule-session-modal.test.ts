import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import {
  classifyScheduleReadinessFailure,
  openScheduleSessionModalFromDeepLink,
  openScheduleSessionModalFromCalendar,
  SCHEDULE_SESSION_SEARCH_PERIODS,
} from "../../scripts/lib/playwright-schedule-session-modal";
import {
  BOOKING_ATTEMPTS_PER_TARGET_PAIR,
  buildInProgressSessionBookingAttemptStart,
  buildInProgressSessionBookingBaseStart,
} from "../../scripts/lib/playwright-inprogress-session-setup";

describe("openScheduleSessionModalFromCalendar", () => {
  const target = {
    sessionId: "30d14e05-c3c9-4f5c-8b7c-8fb6fd07897f",
    therapistId: "ffe316bc-2c6d-4421-9509-3dbf930d565d",
    clientId: "23d0285a-2841-47ce-a7cc-99aa5b43dac9",
    startIso: "2026-08-13T16:00:00.000Z",
  };

  it("opens the exact session through the supported Schedule edit deep link", async () => {
    const dialog = { first: () => dialog, waitFor: vi.fn().mockResolvedValue(undefined) };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn((selector: string) => selector === '[role="dialog"]'
        ? { filter: () => dialog }
        : { count: vi.fn().mockResolvedValue(0) }),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    const expiresAtMs = Date.now() + 30 * 60_000;
    await openScheduleSessionModalFromDeepLink(page, "https://app.example.com/schedule", target, expiresAtMs);

    const navigated = new URL(String(vi.mocked(page.goto).mock.calls[0]?.[0]));
    expect(navigated.pathname).toBe("/schedule");
    expect(navigated.searchParams.get("scheduleModal")).toBe("edit");
    expect(navigated.searchParams.get("scheduleSessionId")).toBe(target.sessionId);
    expect(navigated.searchParams.get("scheduleExp")).toBe(String(expiresAtMs));
    expect(dialog.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 30_000 });
  });

  it("rejects invalid session identity before navigating", async () => {
    const goto = vi.fn();
    const page = { goto } as unknown as Page;

    await expect(openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", {
      sessionId: 'not-a-session-id"]',
      therapistId: "not-a-therapist-id",
      clientId: "not-a-client-id",
      startIso: "not-a-date",
    })).rejects.toThrow(/invalid sessionId/i);

    expect(goto).not.toHaveBeenCalled();
  });

  it("rejects non-http localhost Schedule URLs before navigating", async () => {
    const goto = vi.fn();
    const page = { goto } as unknown as Page;

    await expect(openScheduleSessionModalFromCalendar(page, "ftp://localhost/schedule", target))
      .rejects.toThrow(/invalid Schedule URL/i);
    expect(goto).not.toHaveBeenCalled();
  });

  it("keeps a bounded search horizon that covers the maximum fixture range", () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const latestStarts = Array.from({ length: 21 }, (_, seed) => {
      const base = buildInProgressSessionBookingBaseStart(now, seed, "UTC");
      return buildInProgressSessionBookingAttemptStart(base, BOOKING_ATTEMPTS_PER_TARGET_PAIR - 1, "UTC");
    });
    const maxOffsetDays = Math.ceil(Math.max(...latestStarts.map((start) => start.getTime() - now.getTime())) / 86_400_000);

    expect(maxOffsetDays).toBeLessThanOrEqual((SCHEDULE_SESSION_SEARCH_PERIODS - 1) * 7);
    expect(SCHEDULE_SESSION_SEARCH_PERIODS).toBe(12);
  });

  it("normalizes Week view, opens collapsed filters, scopes the client, and traverses before clicking", async () => {
    const events: string[] = [];
    let cardWaits = 0;
    const first = <T extends object>(value: T) => Object.assign(value, { first: () => value });
    const week = first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      getAttribute: vi.fn().mockResolvedValueOnce("false").mockResolvedValue("true"),
      click: vi.fn(async () => { events.push("week-click"); }),
    });
    const clientAttachment = first({ waitFor: vi.fn().mockResolvedValue(undefined) });
    const details = first({
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn(() => ({ click: vi.fn(async () => { events.push("summary-click"); }) })),
    });
    const lockedTherapist = first({ count: vi.fn().mockResolvedValue(1) });
    const therapistSelect = first({ waitFor: vi.fn().mockRejectedValue(new Error("absent")) });
    const clientSelect = first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn((callback: (select: { options: Array<{ value: string }> }) => string[]) =>
        callback({ options: [{ value: target.clientId }] })),
      selectOption: vi.fn(async () => { events.push("client-select"); }),
      inputValue: vi.fn().mockResolvedValue(target.clientId),
    });
    const card = first({
      waitFor: vi.fn(async () => {
        cardWaits += 1;
        if (cardWaits === 1) throw new Error("not in this week");
      }),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn(async () => { events.push("card-click"); }),
    });
    const dialog = first({ waitFor: vi.fn().mockResolvedValue(undefined) });
    const next = first({
      count: vi.fn().mockResolvedValue(1),
      click: vi.fn(async () => { events.push("next-click"); }),
    });
    const locator = vi.fn((selector: string) => {
      if (selector === 'button[aria-label="Week view"]') return week;
      if (selector === "#client-filter") return clientAttachment;
      if (selector === "details") return { filter: () => details };
      if (selector === "select#therapist-filter") return therapistSelect;
      if (selector === "div#therapist-filter") return lockedTherapist;
      if (selector === "select#client-filter") return clientSelect;
      if (selector.startsWith("[data-session-id=")) return card;
      if (selector === '[role="dialog"]') return { filter: () => dialog };
      throw new Error(`Unexpected locator: ${selector}`);
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator,
      getByRole: vi.fn(() => next),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    await openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", target, {
      allowLockedTherapist: true,
    });

    expect(events).toEqual(["week-click", "summary-click", "client-select", "next-click", "card-click"]);
    expect(card.waitFor).toHaveBeenCalledTimes(2);
  });

  it("fails after the bounded period budget with controlled diagnostics", async () => {
    const first = <T extends object>(value: T) => Object.assign(value, { first: () => value });
    const select = (value: string) => first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn((callback: (node: { options: Array<{ value: string }> }) => string[]) =>
        callback({ options: [{ value }] })),
      selectOption: vi.fn().mockResolvedValue(undefined),
      inputValue: vi.fn().mockResolvedValue(value),
    });
    const card = first({ waitFor: vi.fn().mockRejectedValue(new Error("absent")) });
    const next = first({ count: vi.fn().mockResolvedValue(1), click: vi.fn().mockResolvedValue(undefined) });
    const locator = vi.fn((selector: string) => {
      if (selector === 'button[aria-label="Week view"]') return first({
        waitFor: vi.fn().mockResolvedValue(undefined),
        getAttribute: vi.fn().mockResolvedValue("true"),
      });
      if (selector === "#client-filter") return first({ waitFor: vi.fn().mockResolvedValue(undefined) });
      if (selector === "details") return { filter: () => first({ count: vi.fn().mockResolvedValue(0) }) };
      if (selector === "select#therapist-filter") return select(target.therapistId);
      if (selector === "select#client-filter") return select(target.clientId);
      if (selector.startsWith("[data-session-id=")) return card;
      throw new Error(`Unexpected locator: ${selector}`);
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator,
      getByRole: vi.fn(() => next),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    const failure = openScheduleSessionModalFromCalendar(
      page,
      "https://app.example.com/schedule",
      target,
    );
    await expect(failure).rejects.toThrow(/session_card_not_rendered/);
    await expect(failure).rejects.toThrow(new RegExp(target.sessionId));
    await expect(failure).rejects.toThrow(/2026-08-13T16:00:00.000Z/);
    await expect(failure).rejects.toThrow(/after 12 period\(s\)/);

    expect(card.waitFor).toHaveBeenCalledTimes(SCHEDULE_SESSION_SEARCH_PERIODS);
    expect(next.click).toHaveBeenCalledTimes(SCHEDULE_SESSION_SEARCH_PERIODS - 1);
  });

  it("retries a visible card in the same period when the dialog is delayed", async () => {
    const first = <T extends object>(value: T) => Object.assign(value, { first: () => value });
    const select = (value: string) => first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn((callback: (node: { options: Array<{ value: string }> }) => string[]) =>
        callback({ options: [{ value }] })),
      selectOption: vi.fn().mockResolvedValue(undefined),
      inputValue: vi.fn().mockResolvedValue(value),
    });
    const card = first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    });
    const dialog = first({
      waitFor: vi.fn().mockRejectedValueOnce(new Error("raw delayed dialog")).mockResolvedValue(undefined),
    });
    const next = first({ count: vi.fn().mockResolvedValue(1), click: vi.fn().mockResolvedValue(undefined) });
    const locator = vi.fn((selector: string) => {
      if (selector === 'button[aria-label="Week view"]') return first({
        waitFor: vi.fn().mockResolvedValue(undefined),
        getAttribute: vi.fn().mockResolvedValue("true"),
      });
      if (selector === "#client-filter") return first({ waitFor: vi.fn().mockResolvedValue(undefined) });
      if (selector === "details") return { filter: () => first({ count: vi.fn().mockResolvedValue(0) }) };
      if (selector === "select#therapist-filter") return select(target.therapistId);
      if (selector === "select#client-filter") return select(target.clientId);
      if (selector.startsWith("[data-session-id=")) return card;
      if (selector === '[role="dialog"]') return { filter: () => dialog };
      throw new Error(`Unexpected locator: ${selector}`);
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined), locator,
      getByRole: vi.fn(() => next),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    await openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", target);

    expect(card.click).toHaveBeenCalledTimes(2);
    expect(next.click).not.toHaveBeenCalled();
  });

  it("fails closed when the exact therapist option is unavailable", async () => {
    const first = <T extends object>(value: T) => Object.assign(value, { first: () => value });
    const therapist = first({
      waitFor: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockReturnValue([]),
    });
    const locator = vi.fn((selector: string) => {
      if (selector === 'button[aria-label="Week view"]') return first({
        waitFor: vi.fn().mockResolvedValue(undefined),
        getAttribute: vi.fn().mockResolvedValue("true"),
      });
      if (selector === "#client-filter") return first({ waitFor: vi.fn().mockResolvedValue(undefined) });
      if (selector === "details") return { filter: () => first({ count: vi.fn().mockResolvedValue(0) }) };
      if (selector === "select#therapist-filter") return therapist;
      throw new Error(`Unexpected locator: ${selector}`);
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined), locator,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    await expect(openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", target))
      .rejects.toThrow(/identity is not available.*therapist-filter/i);
  });

  it("classifies a login redirect when Schedule never becomes ready", async () => {
    const week = { first: () => week, waitFor: vi.fn().mockRejectedValue(new Error("raw timeout")) };
    const empty = { count: vi.fn().mockResolvedValue(0) };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn((selector: string) => selector === 'button[aria-label="Week view"]' ? week : empty),
      url: vi.fn().mockReturnValue("https://app.example.com/login"),
    } as unknown as Page;

    await expect(openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", target))
      .rejects.toThrow("Schedule did not reach calendar readiness: login_redirect");
  });

  it("fails with a controlled error when Week view does not become selected", async () => {
    const week = {
      first: () => week,
      waitFor: vi.fn().mockResolvedValue(undefined),
      getAttribute: vi.fn().mockResolvedValue("false"),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn(() => week),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
    } as unknown as Page;

    await expect(openScheduleSessionModalFromCalendar(page, "https://app.example.com/schedule", target))
      .rejects.toThrow("week_view_not_selected");
  });
});

describe("classifyScheduleReadinessFailure", () => {
  const buildPage = (url: string, presentSelector?: string, errorBoundary = false): Page => ({
    url: vi.fn().mockReturnValue(url),
    locator: vi.fn((selector: string) => ({
      count: vi.fn().mockResolvedValue(selector === presentSelector ? 1 : 0),
      getAttribute: vi.fn().mockResolvedValue(null),
    })),
    getByRole: vi.fn(() => ({
      count: vi.fn().mockResolvedValue(errorBoundary ? 1 : 0),
    })),
  } as unknown as Page);

  it("reports the controlled Schedule data path and allowlisted error category", async () => {
    const errorBanner = {
      count: vi.fn().mockResolvedValue(1),
      getAttribute: vi.fn(async (name: string) => ({
        "data-schedule-error-path": "sessions",
        "data-schedule-error-category": "insufficient_privilege",
      })[name] ?? null),
    };
    const empty = {
      count: vi.fn().mockResolvedValue(0),
      getAttribute: vi.fn().mockResolvedValue(null),
    };
    const page = {
      url: vi.fn().mockReturnValue("https://app.example.com/schedule"),
      locator: vi.fn((selector: string) => selector === '[data-testid="schedule-data-load-error"]' ? errorBanner : empty),
      getByRole: vi.fn(() => empty),
    } as unknown as Page;

    await expect(classifyScheduleReadinessFailure(page))
      .resolves.toBe("schedule_data_error:sessions:insufficient_privilege");
  });

  it.each([
    ["auth_profile_loading", '[role="status"][aria-label="Checking role access..."]'],
    ["missing_organization", '[data-testid="schedule-missing-org"]'],
    ["schedule_data_error:unknown:unknown", '[data-testid="schedule-data-load-error"]'],
    ["schedule_still_loading", '[data-testid="schedule-loading"]'],
  ] as const)("returns the controlled %s state", async (expected, selector) => {
    await expect(classifyScheduleReadinessFailure(
      buildPage("https://app.example.com/schedule", selector),
    )).resolves.toBe(expected);
  });

  it.each([
    ["https://app.example.com/login", "login_redirect"],
    ["https://app.example.com/unauthorized", "unauthorized_redirect"],
  ] as const)("classifies %s before inspecting rendered Schedule state", async (url, expected) => {
    const page = buildPage(url, '[data-testid="schedule-loading"]');
    await expect(classifyScheduleReadinessFailure(page)).resolves.toBe(expected);
    expect(page.locator).not.toHaveBeenCalled();
  });

  it("recognizes the public application error boundary without capturing its text", async () => {
    await expect(classifyScheduleReadinessFailure(
      buildPage("https://app.example.com/schedule", undefined, true),
    )).resolves.toBe("application_error_boundary");
  });

  it("falls back to a controlled state without serializing page content", async () => {
    await expect(classifyScheduleReadinessFailure(
      buildPage("https://app.example.com/schedule"),
    )).resolves.toBe("schedule_not_ready");
  });
});
