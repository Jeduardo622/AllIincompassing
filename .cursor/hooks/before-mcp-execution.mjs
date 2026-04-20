/**
 * Asks for confirmation on MCP calls that look like SQL/migration execution (fail-open).
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";

const ASK_TOOL_SUBSTRINGS = ["apply_migration", "execute_sql", "executesql", "exec_sql"];

function normalizeToolName(input) {
  const n = input.tool_name;
  return typeof n === "string" ? n.toLowerCase() : "";
}

function main() {
  return readStdinJson().then((input) => {
    const tool = normalizeToolName(input);
    const hits = [];
    for (const s of ASK_TOOL_SUBSTRINGS) {
      if (tool.includes(s)) hits.push(s);
    }

    if (hits.length > 0) {
      process.stdout.write(
        JSON.stringify({
          permission: "ask",
          user_message:
            "This MCP call may run SQL or apply migrations. Confirm only if you trust the arguments and target project.",
          agent_message: `MCP hook tags: ${[...new Set(hits)].join(", ")}.`,
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
