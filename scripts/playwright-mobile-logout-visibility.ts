import { chromium, devices } from "playwright";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import { captureFailureScreenshot, loginAndAssertSession, preflightCredentials } from "./lib/playwright-smoke";

async function run(): Promise<void> {
  loadPlaywrightEnv();

  const baseUrl = process.env.PW_BASE_URL ?? "https://app.allincompassing.ai";
  const credentials = preflightCredentials([
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
    {
      email: process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL,
      password: process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD,
      label: "PW_THERAPIST_EMAIL + PW_THERAPIST_PASSWORD",
    },
  ]);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await page.evaluate(() => {
      const netlifyOverlay = document.querySelector("[data-netlify-deploy-id]");
      if (netlifyOverlay instanceof HTMLElement) {
        netlifyOverlay.style.display = "none";
      }
    });

    const openNavButton = page.getByRole("button", { name: /open navigation/i });
    await openNavButton.click();

    const sidebar = page.locator("#app-sidebar");
    await sidebar.waitFor({ state: "visible", timeout: 15000 });

    const signOutButton = page.getByRole("button", { name: /sign out/i });
    await signOutButton.waitFor({ state: "attached", timeout: 15000 });

    await page.evaluate(() => {
      const sidebarEl = document.querySelector("#app-sidebar");
      if (sidebarEl instanceof HTMLElement) {
        sidebarEl.scrollTop = sidebarEl.scrollHeight;
      }

      const navEl = document.querySelector("#app-sidebar nav");
      if (navEl instanceof HTMLElement) {
        navEl.scrollTop = navEl.scrollHeight;
      }
    });

    await signOutButton.scrollIntoViewIfNeeded();
    await signOutButton.waitFor({ state: "visible", timeout: 10000 });
    await signOutButton.click();
    await page.waitForURL(/\/login/, { timeout: 20000 });

    console.log("Playwright mobile logout visibility passed");
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, "playwright-mobile-logout-visibility-failure");
    console.error(`Mobile logout visibility smoke failed. Screenshot: ${screenshot}`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("Playwright mobile logout visibility failed", error);
  process.exitCode = 1;
});
