/**
 * Blocks Write/Delete (and common patch tools) into .env* (except examples). Fail-open on errors.
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";
import { extractTargetPath, isProtectedEnvPath } from "./lib/repo-paths.mjs";

/** @param {string} name */
function normTool(name) {
  return name.toLowerCase().replace(/[_-]/g, "");
}

const EDIT_TOOLS = new Set(["write", "delete", "strreplace", "searchreplace", "edit", "applypatch"]);

function main() {
  return readStdinJson().then((input) => {
    const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
    if (!EDIT_TOOLS.has(normTool(toolName))) {
      process.stdout.write(JSON.stringify({ permission: "allow" }));
      process.exit(0);
      return;
    }

    const path = extractTargetPath(input.tool_input);
    if (path && isProtectedEnvPath(path)) {
      process.stdout.write(
        JSON.stringify({
          permission: "deny",
          user_message: "Project hook: writing or deleting protected .env files is blocked.",
          agent_message:
            "Do not modify .env secrets files; use .env.example and runtime config patterns from the repo.",
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
