import type { Page } from "playwright";

export interface ScheduleSessionModalTarget {
  sessionId: string;
  therapistId: string;
  clientId: string;
  startIso?: string;
}

export const SCHEDULE_SESSION_SEARCH_PERIODS = 12;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateTarget = (scheduleUrl: string, target: ScheduleSessionModalTarget): void => {
  for (const [label, value] of [
    ["sessionId", target.sessionId],
    ["therapistId", target.therapistId],
    ["clientId", target.clientId],
  ] as const) {
    if (!UUID_PATTERN.test(value)) {
      throw new Error(`Invalid ${label} for Schedule session lookup.`);
    }
  }
  if (target.startIso && !Number.isFinite(Date.parse(target.startIso))) {
    throw new Error("Invalid startIso for Schedule session lookup.");
  }

  let url: URL;
  try {
    url = new URL(scheduleUrl);
  } catch {
    throw new Error("Invalid Schedule URL for session lookup.");
  }
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const validProtocol = url.protocol === "https:" || (localhost && url.protocol === "http:");
  if (url.pathname !== "/schedule" || url.username || url.password || url.hash || !validProtocol) {
    throw new Error("Invalid Schedule URL for session lookup.");
  }
};

export type ScheduleReadinessFailureState =
  | "login_redirect"
  | "unauthorized_redirect"
  | "auth_profile_loading"
  | "missing_organization"
  | `schedule_data_error:${"sessions" | "dropdown" | "unknown"}:${
      | "insufficient_privilege"
      | "undefined_function"
      | "undefined_table"
      | "undefined_column"
      | "schema_cache"
      | "jwt"
      | "raised_exception"
      | "unknown"}`
  | "schedule_still_loading"
  | "application_error_boundary"
  | "schedule_not_ready";

export const classifyScheduleReadinessFailure = async (
  page: Page,
): Promise<ScheduleReadinessFailureState> => {
  const pathname = new URL(page.url()).pathname.toLowerCase();
  if (pathname.includes("/login")) return "login_redirect";
  if (pathname.includes("/unauthorized")) return "unauthorized_redirect";
  if ((await page.locator('[role="status"][aria-label="Checking role access..."]').count()) > 0) {
    return "auth_profile_loading";
  }
  if ((await page.locator('[data-testid="schedule-missing-org"]').count()) > 0) return "missing_organization";
  const scheduleDataError = page.locator('[data-testid="schedule-data-load-error"]');
  if ((await scheduleDataError.count()) > 0) {
    const rawPath = await scheduleDataError.getAttribute("data-schedule-error-path");
    const path = rawPath === "sessions" || rawPath === "dropdown" ? rawPath : "unknown";
    const rawCategory = await scheduleDataError.getAttribute("data-schedule-error-category");
    const allowedCategories = new Set([
      "insufficient_privilege", "undefined_function", "undefined_table", "undefined_column",
      "schema_cache", "jwt", "raised_exception", "unknown",
    ]);
    const category = rawCategory && allowedCategories.has(rawCategory) ? rawCategory : "unknown";
    return `schedule_data_error:${path}:${category}` as ScheduleReadinessFailureState;
  }
  if ((await page.locator('[data-testid="schedule-loading"]').count()) > 0) return "schedule_still_loading";
  if ((await page.getByRole("heading", { name: "Something went wrong", exact: true }).count()) > 0) {
    return "application_error_boundary";
  }
  return "schedule_not_ready";
};

const openScheduleFiltersIfCollapsed = async (page: Page): Promise<void> => {
  await page.locator("#client-filter").first().waitFor({ state: "attached", timeout: 12_000 });
  const filterDetails = page.locator("details").filter({ has: page.locator("#client-filter") }).first();
  if ((await filterDetails.count()) === 0) {
    return;
  }

  const isOpen = await filterDetails.evaluate((node) => (node instanceof HTMLDetailsElement ? node.open : true));
  if (!isOpen) {
    await filterDetails.locator(":scope > summary").click();
  }
  await page.locator("select#client-filter").waitFor({ state: "visible", timeout: 10_000 });
};

const selectExactScheduleFilter = async (
  page: Page,
  selector: "#therapist-filter" | "#client-filter",
  value: string,
  options: { allowMissingControl?: boolean } = {},
): Promise<boolean> => {
  const filter = page.locator(`select${selector}`).first();
  const attached = await filter
    .waitFor({ state: "attached", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  if (!attached) {
    const lockedControl = page.locator(`div${selector}`).first();
    const locked = options.allowMissingControl && (await lockedControl.count()) > 0;
    if (locked) return false;
    throw new Error(`Required Schedule filter control is missing: ${selector}`);
  }

  for (let optionAttempt = 0; optionAttempt < 48; optionAttempt += 1) {
    const values = await filter.evaluate((select) =>
      Array.from((select as HTMLSelectElement).options).map((option) => option.value),
    );
    if (values.includes(value)) {
      await filter.selectOption(value);
      if ((await filter.inputValue()) !== value) {
        throw new Error(`Schedule filter did not retain the requested value: ${selector}`);
      }
      return true;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`Booked session identity is not available in Schedule filter: ${selector}`);
};

const normalizeWeekView = async (page: Page): Promise<void> => {
  const weekButton = page.locator('button[aria-label="Week view"]').first();
  const ready = await weekButton
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    throw new Error(`Schedule did not reach calendar readiness: ${await classifyScheduleReadinessFailure(page)}`);
  }
  if ((await weekButton.getAttribute("aria-pressed")) !== "true") {
    await weekButton.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    for (let readinessAttempt = 0; readinessAttempt < 40; readinessAttempt += 1) {
      if ((await weekButton.getAttribute("aria-pressed")) === "true") return;
      await page.waitForTimeout(250);
    }
    throw new Error("Schedule did not reach calendar readiness: week_view_not_selected");
  }
};

export const openScheduleSessionModalFromCalendar = async (
  page: Page,
  scheduleUrl: string,
  target: ScheduleSessionModalTarget,
  options: { allowLockedTherapist?: boolean } = {},
): Promise<void> => {
  validateTarget(scheduleUrl, target);
  await page.goto(`${scheduleUrl}?_${Date.now()}`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  await normalizeWeekView(page);
  await openScheduleFiltersIfCollapsed(page);
  const selectedTherapist = await selectExactScheduleFilter(page, "#therapist-filter", target.therapistId, {
    allowMissingControl: options.allowLockedTherapist === true,
  });
  const selectedClient = await selectExactScheduleFilter(page, "#client-filter", target.clientId);
  if (selectedTherapist || selectedClient) {
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    // Schedule applies exact-pair filters after a 300 ms debounce.
    await page.waitForTimeout(750);
  }

  let visitedPeriods = 0;
  let lastInteractionError = "session_card_not_rendered";
  for (let periodAttempt = 0; periodAttempt < SCHEDULE_SESSION_SEARCH_PERIODS; periodAttempt += 1) {
    visitedPeriods = periodAttempt + 1;
    const sessionCard = page.locator(`[data-session-id="${target.sessionId}"]`).first();
    const visible = await sessionCard
      .waitFor({ state: "visible", timeout: periodAttempt === 0 ? 12_000 : 5_000 })
      .then(() => true)
      .catch(() => false);

    if (visible) {
      for (let clickAttempt = 0; clickAttempt < 3; clickAttempt += 1) {
        try {
          await sessionCard.scrollIntoViewIfNeeded();
          await sessionCard.click();
          const dialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i }).first();
          await dialog.waitFor({ state: "visible", timeout: 12_000 });
          return;
        } catch (error) {
          void error;
          lastInteractionError = "card_click_or_dialog_not_visible";
          await page.waitForTimeout(500 + clickAttempt * 250);
        }
      }
      break;
    }

    if (periodAttempt === SCHEDULE_SESSION_SEARCH_PERIODS - 1) {
      break;
    }

    const nextPeriodButton = page.getByRole("button", { name: /next period/i }).first();
    if ((await nextPeriodButton.count()) === 0) {
      lastInteractionError = "next_period_control_missing";
      break;
    }
    await nextPeriodButton.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(500 + periodAttempt * 250);
  }

  throw new Error(
    `Session modal did not open from the scoped Schedule after ${visitedPeriods} period(s). ` +
      `sessionId=${target.sessionId} sessionStartIso=${target.startIso ?? "unknown"} ` +
      `lastInteractionError=${lastInteractionError.slice(0, 300)}`,
  );
};
