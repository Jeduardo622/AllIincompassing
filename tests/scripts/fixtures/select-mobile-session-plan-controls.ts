import { chromium } from "playwright";

import { selectSessionPlanControls } from "../../../scripts/lib/playwright-session-plan-controls";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.setContent(`
    <details id="program-disclosure">
      <summary>Selected programs</summary>
      <button data-program-id="program-mobile" aria-pressed="false"
        onclick="this.setAttribute('aria-pressed', 'true')">Program</button>
    </details>
    <details id="goal-disclosure">
      <summary>Additional goals</summary>
      <button data-goal-id="goal-mobile" aria-pressed="false"
        onclick="this.setAttribute('aria-pressed', 'true')">Goal</button>
    </details>
  `);

  const selected = await selectSessionPlanControls(page, "program-mobile", "goal-mobile");
  const disclosureState = await page.evaluate(() => ({
    programDisclosureOpen: document.querySelector<HTMLDetailsElement>("#program-disclosure")?.open ?? false,
    goalDisclosureOpen: document.querySelector<HTMLDetailsElement>("#goal-disclosure")?.open ?? false,
  }));

  console.log(JSON.stringify({ selected, ...disclosureState }));
} finally {
  await browser.close();
}
