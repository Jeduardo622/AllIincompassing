import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSyntheticPostgresUrl } from
  "./helpers/syntheticPostgresUrl";

const contractPath = resolve(process.cwd(), "scripts/agent-work-ledger-trace-index-contract.mjs");
const contractUrl = pathToFileURL(contractPath);

describe("agent trace report selector failure handling", () => {
  it("converts database client errors into a sanitized contract failure", async () => {
    const source = readFileSync(contractPath, "utf8");
    expect(source).toContain("export const attachDatabaseErrorGuard");

    const { attachDatabaseErrorGuard, sanitizeFailure } = await import(contractUrl.href);
    const database = new EventEmitter();
    const readFailure = attachDatabaseErrorGuard(database);

    database.emit("error", new Error(buildSyntheticPostgresUrl(
      "postgresql",
      "user",
      "secret",
      "host",
      null,
      "database",
      "",
    )));

    const failure = readFailure();
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("database_client_failed");
    expect(sanitizeFailure(failure)).toBe("database_contract_failed");
  });
});
