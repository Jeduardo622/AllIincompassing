import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { validateProgressionHarnessEnvironment } = require("../../cypress/progression/safety.cjs") as {
  validateProgressionHarnessEnvironment: (env: Record<string, string | undefined>) => {
    baseUrl: string;
    supabaseUrl: string;
    databaseUrl: string;
    projectId: string;
  };
};

const valid = {
  PROGRESSION_E2E_LOCAL_OPT_IN: "YES_LOCAL_SYNTHETIC_ONLY",
  PROGRESSION_E2E_PROJECT_ID: "AllIincompassing",
  CYPRESS_BASE_URL: "http://127.0.0.1:4173",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_DB_URL: "postgresql://postgres:secret@127.0.0.1:54322/postgres",
};

describe("goal-target progression Cypress safety gate", () => {
  it("uses an isolated support file without the global runtime or auth stubs", () => {
    const config = readFileSync(path.join(process.cwd(), "cypress.config.progression.cjs"), "utf8");
    const support = readFileSync(path.join(process.cwd(), "cypress", "support", "progression-e2e.ts"), "utf8");
    expect(config).toContain('supportFile: "cypress/support/progression-e2e.ts"');
    expect(config).not.toContain('supportFile: "cypress/support/e2e.ts"');
    expect(config.indexOf("validateProgressionHarnessEnvironment(process.env)")).toBeLessThan(config.indexOf("setupNodeEvents"));
    expect(support).not.toMatch(/import\s+["'].\/commands["']/);
    expect(support).not.toContain("cy.login(");
    expect(support).not.toContain("cy.intercept(");
  });

  it("accepts only the explicit local synthetic configuration", () => {
    expect(validateProgressionHarnessEnvironment(valid)).toMatchObject({
      baseUrl: valid.CYPRESS_BASE_URL,
      supabaseUrl: valid.SUPABASE_URL,
      databaseUrl: valid.SUPABASE_DB_URL,
      projectId: "AllIincompassing",
    });
  });

  it.each([
    ["missing opt-in", { PROGRESSION_E2E_LOCAL_OPT_IN: undefined }],
    ["hosted app", { CYPRESS_BASE_URL: "https://app.example.com" }],
    ["hosted Supabase", { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }],
    ["remote database", { SUPABASE_DB_URL: "postgresql://postgres:secret@db.example.com:5432/postgres" }],
    ["unexpected project", { PROGRESSION_E2E_PROJECT_ID: "production" }],
    ["credential-bearing app URL", { CYPRESS_BASE_URL: "http://user:password@127.0.0.1:4173" }],
  ])("rejects %s before fixture mutation", (_label, override) => {
    expect(() => validateProgressionHarnessEnvironment({ ...valid, ...override })).toThrow(/refusing progression Cypress harness/i);
  });

  it("does not include database credentials in rejection messages", () => {
    expect(() => validateProgressionHarnessEnvironment({
      ...valid,
      SUPABASE_DB_URL: "postgresql://postgres:do-not-print@db.example.com:5432/postgres",
    })).toThrowError(expect.not.stringContaining("do-not-print"));
  });
});
