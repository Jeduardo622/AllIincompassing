/**
 * After successful edits, remind verification when AGENTS.md high-risk paths change.
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";
import { extractTargetPath, isHighRiskRepoPath } from "./lib/repo-paths.mjs";

/** @param {string} name */
function normTool(name) {
  return name.toLowerCase().replace(/[_-]/g, "");
}

const EDIT_TOOLS = new Set(["write", "delete", "strreplace", "searchreplace", "edit", "applypatch"]);

function main() {
  return readStdinJson().then((input) => {
    const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
    if (!EDIT_TOOLS.has(normTool(toolName))) {
      process.stdout.write("{}");
      process.exit(0);
      return;
    }

    const path = extractTargetPath(input.tool_input);
    if (!path || !isHighRiskRepoPath(path)) {
      process.stdout.write("{}");
      process.exit(0);
      return;
    }

    const msg = [
      "[Project hook] This edit touched a high-risk path per AGENTS.md.",
      "Before claiming done: npm run ci:check-focused (when policy-relevant), npm run lint, npm run typecheck, npm run test:ci, and npm run build as appropriate.",
      "If migrations / RLS / tenant boundaries changed, also run npm run validate:tenant.",
    ].join("\n");

    process.stdout.write(JSON.stringify({ additional_context: msg }));
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
