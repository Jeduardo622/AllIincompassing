import { run as runLifecycle } from "./playwright-session-lifecycle";

process.env.PW_LIFECYCLE_TERMINAL_STATUS = "completed";
console.log(
  JSON.stringify({
    ok: true,
    stage: "terminal-flow-select",
    terminalStatus: "completed",
  }),
);

runLifecycle().catch((error) => {
  console.error(error);
  process.exit(1);
});
