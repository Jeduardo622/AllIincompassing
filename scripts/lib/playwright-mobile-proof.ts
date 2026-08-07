import fs from "node:fs";
import path from "node:path";
import { devices, type BrowserContextOptions, type Locator } from "playwright";

import { ensureArtifactsDir } from "./playwright-smoke";

const MOBILE_CONTEXT_ENV_KEY = "PW_MOBILE_CONTEXT";
const MOBILE_CONTEXT_TRUTHY = /^(1|true|yes)$/i;
const SAFE_PROOF_PATHNAMES = new Set([
  "/api/session-notes/upsert",
  "/api/sessions-complete",
]);

const { defaultBrowserType: _defaultBrowserType, ...iPhone13 } = devices["iPhone 13"];
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

export type SafeApiProofEntry = {
  method: string;
  pathname: string;
  status: number;
  timestamp: string;
};

export type SafeProofPayload = {
  ok: boolean;
  mode: "mobile" | "desktop";
  script: string;
  screenshotPath: string | null;
  api: SafeApiProofEntry[];
};

export const shouldUseMobilePlaywrightContext = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => MOBILE_CONTEXT_TRUTHY.test(env[MOBILE_CONTEXT_ENV_KEY] ?? "");

export const getPlaywrightMobileContextOptions = (
  env: NodeJS.ProcessEnv = process.env,
): BrowserContextOptions =>
  shouldUseMobilePlaywrightContext(env)
    ? {
        ...iPhone13,
        screen: MOBILE_VIEWPORT,
        viewport: MOBILE_VIEWPORT,
      }
    : {};

export const buildSafeApiProofEntry = ({
  method,
  url,
  status,
  timestamp = new Date().toISOString(),
}: {
  method: string;
  url: string;
  status: number;
  timestamp?: string;
}): SafeApiProofEntry | null => {
  const pathname = new URL(url, "http://localhost").pathname;
  if (!SAFE_PROOF_PATHNAMES.has(pathname)) {
    return null;
  }
  return {
    method: method.toUpperCase(),
    pathname,
    status,
    timestamp,
  };
};

export const appendSafeApiProofEntry = (
  entries: SafeApiProofEntry[],
  input: {
    method: string;
    url: string;
    status: number;
    timestamp?: string;
  },
): void => {
  const entry = buildSafeApiProofEntry(input);
  if (entry) {
    entries.push(entry);
  }
};

export const captureSafeProofLocatorScreenshot = async (
  prefix: string,
  candidates: Array<{ name: string; locator: Locator }>,
): Promise<string | null> => {
  const latestDir = ensureArtifactsDir();
  for (const candidate of candidates) {
    const target = candidate.locator.first();
    const visible = await target.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const screenshotPath = path.join(latestDir, `${prefix}-${candidate.name}-${Date.now()}.png`);
    await target.screenshot({ path: screenshotPath }).catch(() => undefined);
    if (fs.existsSync(screenshotPath)) {
      return screenshotPath;
    }
  }
  return null;
};

export const writeSafeProofArtifact = (
  prefix: string,
  payload: SafeProofPayload,
): string => {
  const latestDir = ensureArtifactsDir();
  const artifactPath = path.join(latestDir, `${prefix}-${Date.now()}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2));
  return artifactPath;
};
