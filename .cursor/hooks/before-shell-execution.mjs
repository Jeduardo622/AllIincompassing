/**
 * Prompts user to confirm potentially risky shell commands (fail-open on errors).
 */
import { readStdinJson } from "./lib/read-stdin-json.mjs";

const ASK_PATTERNS = [
  { id: "network_fetch", re: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i },
  { id: "powershell_iwr", re: /\biwr\s+/i },
  { id: "rm_rf", re: /\brm\b[^\n]*-\s*rf\b/i },
  { id: "rmdir_windows", re: /\brmdir\s+\/s\b/i },
  { id: "remove_item_recurse", re: /Remove-Item\s+[^\n]*-Recurse/i },
  { id: "supabase_db_push_reset", re: /\bsupabase\s+db\s+(push|reset)\b/i },
  { id: "git_force_push", re: /\bgit\s+push\b[^\n]*(\s--force|\s-f)(\s|$)/i },
  { id: "curl_pipe_shell", re: /\|\s*(ba)?sh\b/i },
  { id: "npm_publish", re: /\bnpm\s+publish\b/i },
];

function main() {
  return readStdinJson().then((input) => {
    const command = typeof input.command === "string" ? input.command : "";
    const hits = [];
    for (const { id, re } of ASK_PATTERNS) {
      if (re.test(command)) hits.push(id);
    }
    if (hits.length > 0) {
      process.stdout.write(
        JSON.stringify({
          permission: "ask",
          user_message:
            "A project hook flagged this shell command (network, destructive delete, Supabase DB push/reset, force-push, or similar). Confirm only if you intend to run it.",
          agent_message: `Hook review tags: ${hits.join(", ")}.`,
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
