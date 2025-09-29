import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { handleGetClientDetails } from "./index.ts";

type RpcAccessEvaluator = (params: { role_name: string; target_client_id?: string | null }) => boolean;

interface MockClientConfig {
  userId: string;
  rpcAccess: RpcAccessEvaluator;
  clients: Array<{ id: string; [key: string]: unknown }>;
  sessions: Array<{ client_id: string; therapist_id: string }>;
}

class ClientQueryBuilder {
  #idFilter: string | null = null;
  #therapistFilter: string | null = null;

  constructor(
    private readonly clients: MockClientConfig["clients"],
    private readonly sessions: MockClientConfig["sessions"],
  ) {}

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: string) {
    if (column === "id") {
      this.#idFilter = value;
    }
    if (column === "sessions.therapist_id") {
      this.#therapistFilter = value;
    }
    return this;
  }

  async single() {
    let filtered = [...this.clients];

    if (this.#idFilter) {
      filtered = filtered.filter(client => client.id === this.#idFilter);
    }

    if (this.#therapistFilter) {
      filtered = filtered.filter(client =>
        this.sessions.some(
          session => session.client_id === client.id && session.therapist_id === this.#therapistFilter,
        )
      );
    }

    if (filtered.length === 0) {
      return { data: null, error: { message: "No rows" } };
    }

    return { data: filtered[0], error: null };
  }
}

function createMockSupabaseClient(config: MockClientConfig): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: config.userId } }, error: null }),
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === "user_has_role_for_org") {
        const result = config.rpcAccess(params as { role_name: string; target_client_id?: string | null });
        return { data: result, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table !== "clients") {
        throw new Error(`Unexpected table requested: ${table}`);
      }
      return new ClientQueryBuilder(config.clients, config.sessions) as unknown as ReturnType<SupabaseClient["from"]>;
    },
  } as unknown as SupabaseClient;
}

function createRequest(body: unknown) {
  return new Request("http://localhost/get-client-details", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function createUserContext(role: UserContext["profile"]["role"], userId: string): UserContext {
  return {
    user: { id: userId, email: `${userId}@example.com` },
    profile: { id: userId, email: `${userId}@example.com`, role, is_active: true },
  };
}

Deno.test("therapist can access assigned client via sessions join", async () => {
  const userId = "therapist-1";
  const clientId = "client-1";
  const db = createMockSupabaseClient({
    userId,
    rpcAccess: ({ role_name, target_client_id }) => role_name === "therapist" && target_client_id === clientId,
    clients: [{ id: clientId, full_name: "Client One" }],
    sessions: [{ client_id: clientId, therapist_id: userId }],
  });

  const response = await handleGetClientDetails({
    req: createRequest({ clientId }),
    userContext: createUserContext("therapist", userId),
    db,
  });

  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.client.id, clientId);
});

Deno.test("admin can access client when organization role is granted", async () => {
  const userId = "admin-1";
  const clientId = "client-42";
  const db = createMockSupabaseClient({
    userId,
    rpcAccess: ({ role_name, target_client_id }) => role_name === "admin" && target_client_id === clientId,
    clients: [{ id: clientId, full_name: "Client Admin" }],
    sessions: [],
  });

  const response = await handleGetClientDetails({
    req: createRequest({ clientId }),
    userContext: createUserContext("admin", userId),
    db,
  });

  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.client.id, clientId);
});

Deno.test("client can retrieve own record when scoped to organization", async () => {
  const userId = "client-99";
  const db = createMockSupabaseClient({
    userId,
    rpcAccess: ({ role_name, target_client_id }) => role_name === "client" && target_client_id === userId,
    clients: [{ id: userId, full_name: "Self Client" }],
    sessions: [],
  });

  const response = await handleGetClientDetails({
    req: createRequest({ clientId: userId }),
    userContext: createUserContext("client", userId),
    db,
  });

  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.client.id, userId);
});

