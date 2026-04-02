import { run as runLifecycle } from "./playwright-session-lifecycle";

process.env.PW_LIFECYCLE_TERMINAL_STATUS = "completed";

runLifecycle().catch((error) => {
  console.error(error);
  process.exit(1);
});
