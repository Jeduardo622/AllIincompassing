import { sendSlackAlert } from "./slack";

type ArgMap = Record<string, string | boolean>;

const parseArgs = (): ArgMap => {
  const args: ArgMap = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!entry.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = entry.slice(2).split("=");
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = raw[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

const args = parseArgs();
const title = (args.title as string) || "Alert notification";
const text = (args.text as string) || "No alert details provided.";
const severity = typeof args.severity === "string" ? args.severity : undefined;
const runbookUrl = typeof args.runbook === "string" ? args.runbook : undefined;
const source = typeof args.source === "string" ? args.source : undefined;
const channel = typeof args.channel === "string"
  ? args.channel
  : process.env.SLACK_ALERTS_CHANNEL;
const dryRun = Boolean(args["dry-run"]);

if (dryRun) {
  console.log("Slack alert dry-run:", {
    title,
    text,
    severity,
    runbookUrl,
    source,
    channel,
  });
  process.exit(0);
}

await sendSlackAlert({
  title,
  text,
  severity,
  runbookUrl,
  source,
  channel,
});
