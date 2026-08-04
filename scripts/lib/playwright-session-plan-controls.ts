import type { Page } from "playwright";

type PlanControlKind = "program" | "goal";

const buildPlanControlSelector = (kind: PlanControlKind, id: string): string =>
  `[data-${kind}-id=${JSON.stringify(id)}]:visible`;

export const buildSessionPlanControlSelectors = (
  programId: string,
  goalId: string,
): { programSelector: string; goalSelector: string } => ({
  programSelector: buildPlanControlSelector("program", programId),
  goalSelector: buildPlanControlSelector("goal", goalId),
});

const isControlSelected = async (
  page: Page,
  selector: string,
): Promise<boolean> => page.locator(selector).first().evaluate((element) =>
  element instanceof HTMLInputElement
    ? element.checked
    : element.getAttribute("aria-pressed") === "true");

const selectPlanControl = async (
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<boolean> => {
  const control = page.locator(selector).first();
  const visible = await control
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    return false;
  }
  if (!(await isControlSelected(page, selector))) {
    await control.click();
  }
  return isControlSelected(page, selector);
};

export const selectSessionProgramControl = (
  page: Page,
  programId: string,
  timeoutMs = 10_000,
): Promise<boolean> =>
  selectPlanControl(page, buildPlanControlSelector("program", programId), timeoutMs);

export const selectSessionGoalControl = (
  page: Page,
  goalId: string,
  timeoutMs = 10_000,
): Promise<boolean> =>
  selectPlanControl(page, buildPlanControlSelector("goal", goalId), timeoutMs);

export const selectSessionPlanControls = async (
  page: Page,
  programId: string,
  goalId: string,
  timeoutMs = 10_000,
): Promise<boolean> =>
  (await selectSessionProgramControl(page, programId, timeoutMs)) &&
  (await selectSessionGoalControl(page, goalId, timeoutMs));

export const waitForSessionPlanControlIds = async (
  page: Page,
  kind: PlanControlKind,
  timeoutMs = 10_000,
): Promise<string[]> => {
  const attribute = `data-${kind}-id`;
  await page.waitForFunction(
    (name) => document.querySelector(`[${name}]`) !== null,
    attribute,
    { timeout: timeoutMs },
  );
  return page.locator(`[${attribute}]`).evaluateAll((elements, name) =>
    Array.from(new Set(
      elements
        .map((element) => element.getAttribute(name))
        .filter((value): value is string => Boolean(value)),
    )), attribute);
};

export const readSelectedSessionPlanIds = async (
  page: Page,
): Promise<{ programIds: string[]; goalIds: string[] }> => page.evaluate(() => {
  const selectedElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-program-id], [data-goal-id]"),
  ).filter((element) =>
    element instanceof HTMLInputElement
      ? element.checked
      : element.getAttribute("aria-pressed") === "true");

  return {
    programIds: Array.from(new Set(
      selectedElements
        .map((element) => element.getAttribute("data-program-id"))
        .filter((value): value is string => Boolean(value)),
    )),
    goalIds: Array.from(new Set(
      selectedElements
        .map((element) => element.getAttribute("data-goal-id"))
        .filter((value): value is string => Boolean(value)),
    )),
  };
});
