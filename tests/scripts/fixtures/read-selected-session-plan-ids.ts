import { chromium } from "playwright";

import { readSelectedSessionPlanIds } from "../../../scripts/lib/playwright-session-plan-controls";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`
    <input type="checkbox" data-program-id="program-selected" checked>
    <input type="checkbox" data-program-id="program-unselected">
    <button data-goal-id="goal-selected" aria-pressed="true"></button>
    <button data-goal-id="goal-unselected" aria-pressed="false"></button>
  `);

  console.log(JSON.stringify(await readSelectedSessionPlanIds(page)));
} finally {
  await browser.close();
}
