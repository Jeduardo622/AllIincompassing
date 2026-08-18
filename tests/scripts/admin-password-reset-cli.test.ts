import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("admin password reset cli entry guard", () => {
  it("uses a resolved pathToFileURL direct-execution check for cross-platform safety", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts", "admin-password-reset.js"),
      "utf8",
    );

    expect(source).toContain("import { resolve } from 'node:path';");
    expect(source).toContain("import { pathToFileURL } from 'node:url';");
    expect(source).toContain(
      "if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)",
    );
    expect(source).not.toContain("if (import.meta.url === `file://${process.argv[1]}`)");
  });
});
