import { describe, expect, it } from "vitest";

import {
  buildLocalRuntimeEnv,
  parseSupabaseStatusEnv,
  validateLocalSupabaseEnv,
} from "../agentWorkLedgerLocal";

const STATUS_OUTPUT = `ANON_KEY="anon-local"
API_URL="http://127.0.0.1:54321"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
PUBLISHABLE_KEY="publishable-local"
SECRET_KEY="secret-local"
SERVICE_ROLE_KEY="service-local"
`;

describe("agentWorkLedgerLocal", () => {
  it("parses the local Supabase status output", () => {
    expect(parseSupabaseStatusEnv(STATUS_OUTPUT)).toMatchObject({
      API_URL: "http://127.0.0.1:54321",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      ANON_KEY: "anon-local",
      PUBLISHABLE_KEY: "publishable-local",
      SERVICE_ROLE_KEY: "service-local",
    });
  });

  it("builds the expected local runtime environment", () => {
    const env = buildLocalRuntimeEnv(parseSupabaseStatusEnv(STATUS_OUTPUT));
    expect(env).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "anon-local",
      VITE_SUPABASE_ANON_KEY: "publishable-local",
      SUPABASE_SERVICE_ROLE_KEY: "service-local",
      SUPABASE_EDGE_URL: "http://127.0.0.1:54321/functions/v1",
      SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
  });

  it("rejects hosted URLs, hosted refs, and mismatched keys", () => {
    const statusEnv = parseSupabaseStatusEnv(STATUS_OUTPUT);
    const errors = validateLocalSupabaseEnv(
      {
        SUPABASE_URL: "https://wnnjeqheqxxyrgsjmygy.supabase.co",
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_SERVICE_ROLE_KEY: "hosted-service-key",
      },
      statusEnv,
    );

    expect(errors).toEqual([
      "SUPABASE_URL must target localhost or 127.0.0.1, got https://wnnjeqheqxxyrgsjmygy.supabase.co.",
      "SUPABASE_PROJECT_REF must be unset for local-only ledger commands, got wnnjeqheqxxyrgsjmygy.",
      "SUPABASE_URL does not match the local Supabase value discovered from `supabase status -o env`.",
      "SUPABASE_SERVICE_ROLE_KEY does not match the local Supabase key discovered from `supabase status -o env`.",
    ]);
  });

  it("accepts matching local URLs and keys", () => {
    const statusEnv = parseSupabaseStatusEnv(STATUS_OUTPUT);
    const env = buildLocalRuntimeEnv(statusEnv);
    expect(validateLocalSupabaseEnv(env, statusEnv)).toEqual([]);
  });
});
