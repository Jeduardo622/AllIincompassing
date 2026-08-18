import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "playwright-env-readiness.mjs");

const runReadiness = (env: NodeJS.ProcessEnv) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "playwright-env-readiness-"));
  writeFileSync(path.join(cwd, "redacted-smoke-fixture.pdf"), "redacted fixture\n", "utf8");

  execFileSync(process.execPath, [scriptPath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...env,
    },
    encoding: "utf8",
  });

  const reportPath = path.join(cwd, "artifacts", "latest", "readiness", "playwright-env-readiness.json");
  return JSON.parse(readFileSync(reportPath, "utf8")) as {
    result: string;
    groups: Array<{ id: string; status: string; variables?: Array<{ name: string; status: string }> }>;
  };
};

describe("playwright-env-readiness", () => {
  it("classifies required Playwright inputs without writing secret values", () => {
    const report = runReadiness({
      PW_BASE_URL: "https://deploy-preview-1.example.test",
      PW_SCHEDULE_EMAIL: "schedule@example.test",
      PW_SCHEDULE_PASSWORD: "schedule-password",
      CI_SMOKE_THERAPIST_SCOPE_EMAIL: "schedule@example.test",
      PW_FOREIGN_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
      PW_FOREIGN_THERAPIST_ID: "00000000-0000-4000-8000-000000000002",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_PUBLISHABLE_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      PW_ASSESSMENT_CLIENT_ID: "00000000-0000-4000-8000-000000000003",
      PW_ASSESSMENT_SAMPLE_FILE: "redacted-smoke-fixture.pdf",
      PW_CLINICAL_QA_EMAIL: "qa@example.test",
      PW_CLINICAL_QA_PASSWORD: "****",
      PW_CLINICAL_QA_TARGET_MARKER: "redacted",
      PW_CLINICAL_QA_ROUTE: "/clients/redacted-smoke-client?tab=programs-goals",
      PW_CLINICAL_QA_SOURCE_FILE: "redacted-smoke-fixture.pdf",
      PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR: "[data-testid='generate-redacted-output']",
    });

    expect(report.result).toBe("pass");
    expect(report.groups.find((group) => group.id === "clinical_qa_persona")?.status).toBe("placeholder");
    expect(report.groups.find((group) => group.id === "clinical_qa_artifacts")?.status).toBe("configured");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("schedule-password");
    expect(serialized).not.toContain("service-role-key");
  });

  it("marks malformed foreign IDs and missing fixture paths as not_validated", () => {
    const report = runReadiness({
      PW_BASE_URL: "https://deploy-preview-1.example.test",
      PW_ADMIN_EMAIL: "admin@example.test",
      PW_ADMIN_PASSWORD: "admin-password",
      CI_SMOKE_THERAPIST_SCOPE_EMAIL: "admin@example.test",
      PW_FOREIGN_CLIENT_ID: "client-id",
      PW_FOREIGN_THERAPIST_ID: "therapist-id",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_PUBLISHABLE_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      PW_ASSESSMENT_CLIENT_ID: "00000000-0000-4000-8000-000000000003",
      PW_ASSESSMENT_SAMPLE_FILE: "missing-redacted-smoke-fixture.pdf",
    });

    expect(report.result).toBe("fail");
    expect(report.groups.find((group) => group.id === "foreign_access_ids")?.status).toBe("not_validated");
    expect(report.groups.find((group) => group.id === "assessment_smoke_client")?.status).toBe("not_validated");
  });

  it("accepts clinical QA expectations file as an alternative to source file", () => {
    const report = runReadiness({
      PW_BASE_URL: "https://deploy-preview-1.example.test",
      PW_ADMIN_EMAIL: "admin@example.test",
      PW_ADMIN_PASSWORD: "admin-password",
      CI_SMOKE_THERAPIST_SCOPE_EMAIL: "admin@example.test",
      PW_FOREIGN_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
      PW_FOREIGN_THERAPIST_ID: "00000000-0000-4000-8000-000000000002",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_PUBLISHABLE_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      PW_ASSESSMENT_CLIENT_ID: "00000000-0000-4000-8000-000000000003",
      PW_ASSESSMENT_SAMPLE_FILE: "redacted-smoke-fixture.pdf",
      PW_CLINICAL_QA_TARGET_MARKER: "smoke",
      PW_CLINICAL_QA_CLIENT_ID: "00000000-0000-4000-8000-000000000004",
      PW_CLINICAL_QA_EXPECTATIONS_FILE: "redacted-smoke-fixture.pdf",
      PW_CLINICAL_QA_OUTPUT_FILE: "redacted-smoke-fixture.pdf",
    });

    expect(report.result).toBe("pass");
    expect(report.groups.find((group) => group.id === "clinical_qa_artifacts")?.status).toBe("configured");
  });
});
