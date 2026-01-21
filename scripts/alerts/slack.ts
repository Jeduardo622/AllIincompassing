type SlackPayload = {
  text: string;
  channel?: string;
};

export type SlackAlertInput = {
  title: string;
  text: string;
  severity?: string;
  runbookUrl?: string;
  source?: string;
  channel?: string;
};

const formatAlertText = (input: SlackAlertInput): SlackPayload => {
  const severity = input.severity ? `[${input.severity.toUpperCase()}] ` : "";
  const source = input.source ? `Source: ${input.source}` : "";
  const runbook = input.runbookUrl ? `Runbook: ${input.runbookUrl}` : "";
  const lines = [
    `${severity}${input.title}`.trim(),
    input.text,
    source,
    runbook,
  ].filter(Boolean);

  return {
    text: lines.join("\n"),
    channel: input.channel,
  };
};

export const sendSlackAlert = async (input: SlackAlertInput): Promise<void> => {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is required");
  }

  const payload = formatAlertText(input);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }
};
