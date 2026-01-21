import { sendSlackAlert } from "./slack";

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
