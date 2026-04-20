/**
 * Blocks Agent reads of .env* (except .env.example / .env.sample). Fail-open on errors.
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";
import { isProtectedEnvPath } from "./lib/repo-paths.mjs";

function main() {
  return readStdinJson().then((input) => {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    if (filePath && isProtectedEnvPath(filePath)) {
      process.stdout.write(
        JSON.stringify({
          permission: "deny",
          user_message:
            "Project hook: reading this .env file into the agent is blocked. Use .env.example or ask explicitly with a redacted snippet if you must discuss shape.",
        }),
      );
    } else {
      process.stdout.write(JSON.stringify({ permission: "allow" }));
    }
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
  process.exit(0);
});
