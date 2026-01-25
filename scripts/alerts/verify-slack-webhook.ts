import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

import { sendSlackAlert } from './slack';

const loadSlackEnv = (): void => {
  const candidates = ['.env.local', '.env.codex', '.env'];
  for (const candidate of candidates) {
    const envPath = path.resolve(candidate);
    if (!fs.existsSync(envPath)) {
      continue;
    }
    loadEnv({ path: envPath, override: false });
    console.log(`[alert:slack:test] Loaded environment variables from ${envPath}.`);
  }
};

loadSlackEnv();

const channel = process.env.SLACK_ALERTS_CHANNEL;
const timestamp = new Date().toISOString();

await sendSlackAlert({
  title: "Synthetic alert check",
  text: `Slack webhook verification fired at ${timestamp}.`,
  severity: "info",
  source: "alert:slack:test",
  channel,
});

console.log("Slack webhook verification sent.");
