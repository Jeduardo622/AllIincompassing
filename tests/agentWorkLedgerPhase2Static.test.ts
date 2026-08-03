import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(
  path.join(process.cwd(), "docker", "agent-work-ledger", "Dockerfile"),
  "utf8",
);
const dockerignore = readFileSync(
  path.join(process.cwd(), ".dockerignore"),
  "utf8",
);

const renderCompose = () => {
  const result = spawnSync("docker", [
    "compose",
    "-f",
    "docker/agent-work-ledger/docker-compose.phase2.yml",
    "config",
    "--format",
    "json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      COMPOSE_DISABLE_ENV_FILE: "1",
      AGENT_WORK_PHASE2_IMAGE: "agent-work-ledger-phase2:test",
      PHASE2_CONTAINER_SUPABASE_URL:
        "http://supabase_kong_AllIincompassing:8000",
      PHASE2_CONTAINER_SUPABASE_DB_URL:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      PHASE2_SUPABASE_ANON_KEY: "synthetic-anon",
      PHASE2_SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
      PHASE2_RUNNER_SECRET: "synthetic-runner-secret",
      PHASE2_SWEEPER_SECRET: "synthetic-sweeper-secret",
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "compose_config_failed");
  }
  return JSON.parse(result.stdout) as {
    services: Record<string, {
      command?: string[];
      entrypoint?: string[];
      environment?: Record<string, string>;
      healthcheck?: { test?: string[] };
      networks?: Record<string, unknown>;
    }>;
    networks: Record<string, { external?: boolean; name?: string }>;
  };
};

describe("agent work ledger phase2 container assets", () => {
  it("renders real app and Deno service commands without an image entrypoint conflict", () => {
    const config = renderCompose();
    expect(config.services["agent-work-app"].command).toEqual([
      "npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4173",
    ]);
    for (const [service, entrypoint] of [
      ["agent-work-items", "supabase/functions/agent-work-items/index.ts"],
      ["agent-work-runner", "supabase/functions/agent-work-runner/index.ts"],
      ["agent-work-sweeper", "supabase/functions/agent-work-sweeper/index.ts"],
    ]) {
      expect(config.services[service].command).toEqual([
        "deno",
        "run",
        "--cached-only",
        "--frozen",
        "--node-modules-dir=none",
        "--lock=/opt/agent-work-ledger-deno.lock",
        "--allow-all",
        entrypoint,
      ]);
      expect(config.services[service].entrypoint).toBeNull();
    }
  });

  it("requires bounded literal HTTP 204 readiness for every Edge Function route", () => {
    const config = renderCompose();
    for (const [service, route] of [
      ["agent-work-items", "agent-work-items"],
      ["agent-work-runner", "agent-work-runner"],
      ["agent-work-sweeper", "agent-work-sweeper"],
    ]) {
      expect(config.services[service].healthcheck?.test).toEqual([
        "CMD-SHELL",
        `status=$$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' -X OPTIONS http://localhost:8000/${route}) && [ "$$status" = "204" ]`,
      ]);
      expect(config.services[service].healthcheck?.test).not.toEqual([
        "CMD", "curl", "-fsS", "--max-time", "2", "-o", "/dev/null",
        "-X", "OPTIONS", `http://localhost:8000/${route}`,
      ]);
    }
  });

  it("renders least-privilege service environments and the external dedicated network", () => {
    const config = renderCompose();
    expect(config.services["agent-work-app"].environment).toEqual({
      AGENT_WORK_APP_RUNTIME_MODE: "shadow",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      SUPABASE_ANON_KEY: "synthetic-anon",
      SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
      VITE_SUPABASE_ANON_KEY: "synthetic-anon",
      VITE_SUPABASE_EDGE_URL: "http://supabase_kong_AllIincompassing:8000",
      VITE_SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "agent-work-app",
    });
    expect(config.services["agent-work-items"].environment).toEqual({
      AGENT_WORK_LEDGER_RUNTIME_MODE: "shadow",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      SUPABASE_ANON_KEY: "synthetic-anon",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
      SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
    });
    expect(config.services["agent-work-runner"].environment).toEqual({
      AGENT_WORK_LEDGER_RUNTIME_MODE: "advisory",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      AGENT_WORK_RUNNER_SECRET: "synthetic-runner-secret",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
      SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
    });
    expect(config.services["agent-work-sweeper"].environment).toEqual({
      AGENT_WORK_LEDGER_RUNTIME_MODE: "advisory",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      AGENT_WORK_SWEEPER_SECRET: "synthetic-sweeper-secret",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
      SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
    });
    expect(config.services["agent-work-harness"].environment).toEqual({
      AGENT_WORK_PHASE2_CONTAINER: "1",
    });
    expect(config.networks["agent-work-phase2"]).toMatchObject({
      external: true,
      name: "agent-work-phase2",
    });
  });

  it("builds pinned runtimes with script-free npm install and image-only Deno lock/cache", () => {
    expect(dockerfile).toContain("FROM denoland/deno:2.8.3");
    expect(dockerfile).toContain("FROM node:20.16.0-bookworm-slim");
    expect(dockerfile).toContain("COPY --from=deno /usr/bin/deno /usr/bin/deno");
    expect(dockerfile).toContain("npm ci --ignore-scripts");
    expect(dockerfile).toContain("/opt/agent-work-ledger-deno.lock");
    expect(dockerfile).toContain("deno cache");
    expect(dockerfile).toContain("--node-modules-dir=none");
    expect(dockerfile).not.toContain("--node-modules-dir=auto");
    expect(dockerfile).toContain("supabase/functions/generate-program-goals/index.ts");
    expect(dockerfile).toContain("supabase/functions/generate-program-goals/index.test.ts");
    expect(dockerfile).not.toContain("ENTRYPOINT");
  });

  it("excludes repository metadata, reports, docs, and office or PDF artifacts from the image", () => {
    const requiredPatterns = [
      ".agents",
      ".cursor",
      ".codex",
      ".superpowers",
      "docs",
      "reports",
      "artifacts",
      "**/*.pdf",
      "**/*.doc",
      "**/*.docx",
      "**/*.xls",
      "**/*.xlsx",
      "**/*.ppt",
      "**/*.pptx",
      "**/*.odt",
      "**/*.ods",
    ];
    const patterns = new Set(dockerignore.split(/\r?\n/).map((line) => line.trim()));
    expect(requiredPatterns.every((pattern) => patterns.has(pattern))).toBe(true);
    expect(dockerfile).toContain("test ! -d /workspace/docs");
    expect(dockerfile).toContain("find /workspace -type f");
    expect(dockerfile).toContain("phase2.image-content-policy");
  });
});
