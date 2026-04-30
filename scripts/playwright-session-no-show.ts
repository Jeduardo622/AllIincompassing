import { run as runLifecycle } from "./playwright-session-lifecycle";

process.env.PW_LIFECYCLE_TERMINAL_STATUS = "no-show";
console.log(
  JSON.stringify({
    ok: true,
    stage: "terminal-flow-select",
    terminalStatus: "no-show",
  }),
);

runLifecycle().catch((error) => {
  console.error(error);
  process.exit(1);
});
