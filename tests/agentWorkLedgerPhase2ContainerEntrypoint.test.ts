import { describe, expect, it } from "vitest";

import {
  buildContainerRoleChildEnv,
  runContainerChildCommand,
  runContainerRole,
} from "../scripts/agent-work-ledger-harness/containerEntrypoint.mjs";

describe("agent work ledger phase2 custom container roles", () => {
  it("seeds synthetic security fixtures before the items smoke", async () => {
    const calls: Array<[string, string[], Record<string, string>]> = [];
    await runContainerRole("items-smoke", {
      env: {
        PATH: "/usr/bin",
        AGENT_WORK_PHASE2_CONTAINER: "1",
        AGENT_WORK_ITEMS_URL: "http://agent-work-items:8000/agent-work-items",
        SUPABASE_ANON_KEY: "public-anon",
        SUPABASE_DB_URL: "phase2-db",
        SUPABASE_URL: "phase2-http",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      },
      runCommand: async (
        command: string,
        args: string[],
        env: Record<string, string>,
      ) => {
        calls.push([command, args, env]);
      },
    });

    expect(calls.map(([command, args]) => [command, args])).toEqual([
      ["node", ["scripts/agent-work-ledger-security-contract.mjs"]],
      ["node", ["scripts/agent-work-ledger-edge-smoke.mjs"]],
    ]);
    expect(calls.map(([, , env]) => env)).toEqual(Array(2).fill({
      AGENT_WORK_ITEMS_URL: "http://agent-work-items:8000/agent-work-items",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      PATH: "/usr/bin",
      SUPABASE_ANON_KEY: "public-anon",
      SUPABASE_DB_URL: "phase2-db",
      SUPABASE_URL: "phase2-http",
    }));
  });

  it("executes retention and trace contracts as real child commands", async () => {
    const calls: Array<[string, string[], Record<string, string>]> = [];
    await runContainerRole("retention-trace", {
      env: {
        PATH: "/usr/bin",
        HOME: "/home/node",
        AGENT_WORK_PHASE2_CONTAINER: "1",
        SUPABASE_DB_URL: "phase2-db",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      },
      runCommand: async (
        command: string,
        args: string[],
        env: Record<string, string>,
      ) => {
        calls.push([command, args, env]);
      },
    });
    expect(calls).toEqual([
      ["node", ["scripts/agent-work-ledger-retention-contract.mjs"], {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        HOME: "/home/node",
        PATH: "/usr/bin",
        SUPABASE_DB_URL: "phase2-db",
      }],
      ["node", ["scripts/agent-work-ledger-trace-index-contract.mjs"], {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        HOME: "/home/node",
        PATH: "/usr/bin",
        SUPABASE_DB_URL: "phase2-db",
      }],
    ]);
  });

  it("executes focused app/API tests, eval, and build", async () => {
    const calls: Array<[string, string[], Record<string, string>]> = [];
    await runContainerRole("app-api-unit-build", {
      env: {
        PATH: "/usr/bin",
        HOME: "/home/node",
        AGENT_WORK_PHASE2_CONTAINER: "1",
        SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
        SUPABASE_ANON_KEY: "public-anon",
        VITE_SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
        VITE_SUPABASE_EDGE_URL: "http://supabase_kong_AllIincompassing:8000",
        VITE_SUPABASE_ANON_KEY: "public-anon",
        SUPABASE_DB_URL: "must-not-leak",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
        AGENT_WORK_RUNNER_SECRET: "must-not-leak",
      },
      runCommand: async (
        command: string,
        args: string[],
        env: Record<string, string>,
      ) => {
        calls.push([command, args, env]);
      },
    });
    expect(calls.map(([command, args]) => [command, args])).toEqual([
      ["npm", ["run", "test:agent-work:eval"]],
      ["node", [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/agentWorkLedgerEval.test.ts",
        "tests/agentWorkLedgerEvalCli.test.ts",
        "src/lib/__tests__/agent-work-ledger.test.ts",
        "src/components/agent-work/__tests__/AssessmentWorkLedgerPanel.test.tsx",
        "src/server/__tests__/runtimeConfigHandler.test.ts",
      ]],
      ["npm", ["run", "build"]],
    ]);
    expect(calls.map(([, , env]) => env)).toEqual(Array(3).fill({
      AGENT_WORK_PHASE2_CONTAINER: "1",
      HOME: "/home/node",
      PATH: "/usr/bin",
      SUPABASE_ANON_KEY: "public-anon",
      SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
      VITE_SUPABASE_ANON_KEY: "public-anon",
      VITE_SUPABASE_EDGE_URL: "http://supabase_kong_AllIincompassing:8000",
      VITE_SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
    }));
  });

  it("builds exact role-specific child environments", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/home/node",
      TMPDIR: "/tmp",
      CI: "1",
      AGENT_WORK_PHASE2_CONTAINER: "1",
      SUPABASE_DB_URL: "phase2-db",
      SUPABASE_URL: "phase2-http",
      SUPABASE_ANON_KEY: "public-anon",
      VITE_SUPABASE_URL: "phase2-http",
      VITE_SUPABASE_EDGE_URL: "phase2-http",
      VITE_SUPABASE_ANON_KEY: "public-anon",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      AGENT_WORK_RUNNER_SECRET: "must-not-leak",
      AGENT_WORK_SWEEPER_SECRET: "must-not-leak",
    };
    expect(buildContainerRoleChildEnv("retention-trace", source)).toEqual({
      AGENT_WORK_PHASE2_CONTAINER: "1",
      CI: "1",
      HOME: "/home/node",
      PATH: "/usr/bin",
      SUPABASE_DB_URL: "phase2-db",
      TMPDIR: "/tmp",
    });
    expect(buildContainerRoleChildEnv("app-api-unit-build", source)).toEqual({
      AGENT_WORK_PHASE2_CONTAINER: "1",
      CI: "1",
      HOME: "/home/node",
      PATH: "/usr/bin",
      SUPABASE_ANON_KEY: "public-anon",
      SUPABASE_URL: "phase2-http",
      TMPDIR: "/tmp",
      VITE_SUPABASE_ANON_KEY: "public-anon",
      VITE_SUPABASE_EDGE_URL: "phase2-http",
      VITE_SUPABASE_URL: "phase2-http",
    });
  });

  it("propagates a real child process nonzero exit", async () => {
    await expect(runContainerChildCommand(
      process.execPath,
      ["-e", "process.exit(7)"],
      { PATH: process.env.PATH ?? "" },
    )).rejects.toThrow("container_child_command_failed");
  });

  it("checks app, local Supabase, and unauthenticated function denial", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    await runContainerRole("stack-health", {
      env: {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        SUPABASE_URL: "http://supabase_kong_AllIincompassing:8000",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, headers: new Headers(init?.headers) });
        const denied = url.startsWith("http://agent-work-") &&
          !url.startsWith("http://agent-work-app");
        return new Response("", { status: denied ? 401 : 200 });
      },
    });

    expect(calls.map(({ url }) => url)).toEqual([
      "http://agent-work-app:4173/",
      "http://agent-work-app:4173/api/runtime-config",
      "http://supabase_kong_alliincompassing:8000/auth/v1/health",
      "http://supabase_kong_alliincompassing:8000/rest/v1/",
      "http://agent-work-items:8000/agent-work-items",
      "http://agent-work-runner:8000/agent-work-runner",
      "http://agent-work-sweeper:8000/agent-work-sweeper",
    ]);
    expect(calls[3].headers.get("authorization")).toBe("Bearer service-role");
    expect(calls.slice(4).every(({ headers }) =>
      !headers.has("authorization") && !headers.has("apikey")
    )).toBe(true);
  });

  it("checks migrated schema, queue relations, extensions, and deterministic seed", async () => {
    const calls: string[] = [];
    class FakeClient {
      async connect() {
        calls.push("connect");
      }
      async query(text: string) {
        calls.push(text);
        if (text === "select current_user") {
          return { rows: [{ current_user: "postgres" }] };
        }
        return {
          rows: [{
            work_items: true,
            work_steps: true,
            work_events: true,
            live_queue: true,
            archive_queue: true,
            pgmq_enabled: true,
            pg_cron_enabled: true,
            pg_net_enabled: true,
            vault_enabled: true,
            deterministic_seed: true,
            step_item_org_client_parity: text.includes(
              "as step_item_org_client_parity",
            ),
            queued_payload_org_parity: text.includes(
              "as queued_payload_org_parity",
            ),
          }],
        };
      }
      async end() {
        calls.push("end");
      }
    }

    await runContainerRole("schema-seed", {
      env: {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        SUPABASE_DB_URL:
          "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      },
      ClientImpl: FakeClient,
    });

    expect(calls[0]).toBe("connect");
    expect(calls.at(-1)).toBe("end");
    expect(calls).toContain("create extension if not exists pg_cron");
    expect(calls).toContain(
      "create extension if not exists pg_net with schema extensions",
    );
    expect(calls).toContain(
      "create extension if not exists supabase_vault with schema vault",
    );
    expect(calls.some((text) => text.includes("pgmq.q_agent_work_steps"))).toBe(true);
    expect(calls.some((text) => text.includes("seed-preview-org"))).toBe(true);
  });

  it("fails schema validation when tenant or queued payload scope parity is broken", async () => {
    class FakeClient {
      async connect() {}
      async query(text: string) {
        if (text === "select current_user") {
          return { rows: [{ current_user: "postgres" }] };
        }
        return {
          rows: [{
            work_items: true,
            work_steps: true,
            work_events: true,
            live_queue: true,
            archive_queue: true,
            pgmq_enabled: true,
            pg_cron_enabled: true,
            pg_net_enabled: true,
            vault_enabled: true,
            deterministic_seed: true,
            step_item_org_client_parity: false,
            queued_payload_org_parity: true,
          }],
        };
      }
      async end() {}
    }

    await expect(runContainerRole("schema-seed", {
      env: {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        SUPABASE_DB_URL:
          "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      },
      ClientImpl: FakeClient,
    })).rejects.toThrow(/container_schema_seed_check_failed/);
  });

  it("rejects generic commands instead of misparsing them as custom roles", async () => {
    await expect(runContainerRole("node", {})).rejects.toThrow(
      /unknown_container_role_node/,
    );
  });
});
