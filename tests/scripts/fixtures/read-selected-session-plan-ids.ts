import type { Page } from "playwright";

import { readSelectedSessionPlanIds } from "../../../scripts/lib/playwright-session-plan-controls";

class FixtureElement {
  constructor(private readonly attributes: Record<string, string>) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

class FixtureInputElement extends FixtureElement {
  constructor(attributes: Record<string, string>, readonly checked: boolean) {
    super(attributes);
  }
}

const elements = [
  new FixtureInputElement({ "data-program-id": "program-selected" }, true),
  new FixtureInputElement({ "data-program-id": "program-unselected" }, false),
  new FixtureElement({ "data-goal-id": "goal-selected", "aria-pressed": "true" }),
  new FixtureElement({ "data-goal-id": "goal-unselected", "aria-pressed": "false" }),
];

const page = {
  evaluate: async <T>(callback: () => T): Promise<T> => {
    const runInPageContext = Function(
      "document",
      "HTMLInputElement",
      `return (${callback.toString()})()`,
    ) as (documentValue: unknown, inputType: unknown) => T;

    return runInPageContext(
      { querySelectorAll: () => elements },
      FixtureInputElement,
    );
  },
} as unknown as Page;

console.log(JSON.stringify(await readSelectedSessionPlanIds(page)));
