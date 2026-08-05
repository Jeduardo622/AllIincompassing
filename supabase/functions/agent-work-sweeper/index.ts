import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.99.0";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { assertAgentWorkSupabaseUrl } from "../_shared/agent-work/runtime-url.ts";
import {
  isAgentWorkServiceRequestAuthorized,
  resolveAgentWorkGatewayApiKeys,
} from "../_shared/agent-work/service-auth.ts";

const INVOCATION_SECRET_HEADER = "x-agent-work-sweeper-secret";
const DEFAULT_MAX_ITEMS_PER_PASS = 25;
const ALLOWED_RUNTIME_MODES = new Set(["advisory"]);
const SAFE_REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

type AgentWorkRuntimeMode = "disabled" | "shadow" | "advisory" | string;

type SweepInvocation = {
  maxItemsPerPass: number;
  now: string;
};

type SweeperEntity = {
  reasonCode?: string;
};

type ApprovalSweepResult = {
  expired: SweeperEntity[];
  skippedCurrent: SweeperEntity[];
};

type PoisonSweepResult = {
  archived: SweeperEntity[];
  retryCeiling: SweeperEntity[];
};

export type AgentWorkSweeperHandlerDependencies = {
  getCorsHeaders: (request: Request) => HeadersInit;
  getInvocationSecret: () => string;
  getGatewayApiKeys: () => string[];
  getRuntimeMode: () => AgentWorkRuntimeMode | Promise<AgentWorkRuntimeMode>;
  getNow: () => Date;
  getMaxItemsPerPass: () => number;
  requeueExpiredLeases: (
    invocation: SweepInvocation,
  ) => Promise<SweeperEntity[]>;
  wakeDueWaitingSteps: (
    invocation: SweepInvocation,
  ) => Promise<SweeperEntity[]>;
  expireApprovals: (
    invocation: SweepInvocation,
  ) => Promise<ApprovalSweepResult>;
  archivePoisonMessages: (
    invocation: SweepInvocation,
  ) => Promise<PoisonSweepResult>;
  emitSanitizedAlert: (alert: unknown) => Promise<void>;
  executeClinicalEffect: () => Promise<void>;
};

function jsonResponse(
  headers: HeadersInit,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeReasonCodes(entities: SweeperEntity[]): string[] {
  return entities
    .map((entity) => entity.reasonCode)
    .filter((reasonCode): reasonCode is string =>
      typeof reasonCode === "string" &&
      SAFE_REASON_CODE_PATTERN.test(reasonCode)
    );
}

function resolvedMaxItemsPerPass(
  requestedValue: unknown,
  configuredValue: number,
): number {
  const safeConfigured =
    Number.isInteger(configuredValue) && configuredValue > 0
      ? configuredValue
      : DEFAULT_MAX_ITEMS_PER_PASS;
  if (!Number.isInteger(requestedValue) || (requestedValue as number) <= 0) {
    return safeConfigured;
  }
  return Math.min(requestedValue as number, safeConfigured);
}

async function parseJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function createUnauthorizedResponse(headers: HeadersInit): Response {
  return jsonResponse(headers, 401, {
    success: false,
    error: "Unauthorized",
  });
}

export function createAgentWorkSweeperHandler(
  deps: AgentWorkSweeperHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const responseHeaders = deps.getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse(responseHeaders, 405, {
        success: false,
        error: "Method not allowed",
      });
    }

    if (!isAgentWorkServiceRequestAuthorized(
      request,
      INVOCATION_SECRET_HEADER,
      deps.getInvocationSecret().trim(),
      deps.getGatewayApiKeys(),
    )) {
      return createUnauthorizedResponse(responseHeaders);
    }

    let runtimeMode: AgentWorkRuntimeMode;
    try {
      runtimeMode = await deps.getRuntimeMode();
    } catch {
      runtimeMode = "disabled";
    }
    if (!ALLOWED_RUNTIME_MODES.has(runtimeMode)) {
      return jsonResponse(responseHeaders, 403, {
        success: false,
        error: "Runtime mode disabled",
        code: "runtime_mode_disabled",
      });
    }

    const body = await parseJsonObject(request);
    if (body === null) {
      return jsonResponse(responseHeaders, 400, {
        success: false,
        error: "Invalid request body",
      });
    }

    const now = deps.getNow();
    const invocation: SweepInvocation = {
      maxItemsPerPass: resolvedMaxItemsPerPass(
        body.maxItemsPerPass,
        deps.getMaxItemsPerPass(),
      ),
      now: now.toISOString(),
    };

    try {
      const recoveredLeases = await deps.requeueExpiredLeases(invocation);
      const wokeWaiting = await deps.wakeDueWaitingSteps(invocation);
      const approvalSweep = await deps.expireApprovals(invocation);
      const poisonSweep = await deps.archivePoisonMessages(invocation);

      const alertCodes = [
        ...sanitizeReasonCodes(recoveredLeases),
        ...sanitizeReasonCodes(wokeWaiting),
        ...sanitizeReasonCodes(approvalSweep.expired),
        ...sanitizeReasonCodes(poisonSweep.archived),
        ...sanitizeReasonCodes(poisonSweep.retryCeiling),
      ];

      await deps.emitSanitizedAlert({
        runtimeMode,
        observedAt: invocation.now,
        recoveredLeaseCount: recoveredLeases.length,
        wokeWaitingCount: wokeWaiting.length,
        expiredApprovalCount: approvalSweep.expired.length,
        archivedPoisonCount: poisonSweep.archived.length,
        retryCeilingCount: poisonSweep.retryCeiling.length,
        alertCodes,
      });

      return jsonResponse(responseHeaders, 200, {
        success: true,
        data: {
          recoveredLeaseCount: recoveredLeases.length,
          wokeWaitingCount: wokeWaiting.length,
          expiredApprovalCount: approvalSweep.expired.length,
          archivedPoisonCount: poisonSweep.archived.length,
          retryCeilingCount: poisonSweep.retryCeiling.length,
          processedActionCount: 4,
          maxItemsPerPass: invocation.maxItemsPerPass,
          alertCodes,
        },
      });
    } catch {
      return jsonResponse(responseHeaders, 500, {
        success: false,
        error: "Sweeper execution failed",
        code: "sweeper_execution_failed",
      });
    }
  };
}

function runtimeMode(): AgentWorkRuntimeMode {
  const configured =
    (Deno.env.get("AGENT_WORK_LEDGER_RUNTIME_MODE") ?? "disabled").trim()
      .toLowerCase();
  return ALLOWED_RUNTIME_MODES.has(configured) ? configured : "disabled";
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

type RpcClient = Pick<SupabaseClient, "rpc" | "from">;

function createServiceClient(): RpcClient {
  const supabaseUrl = assertAgentWorkSupabaseUrl(
    requireEnv("SUPABASE_URL"),
    {
      phase2Container:
        Deno.env.get("AGENT_WORK_PHASE2_CONTAINER")?.trim() === "1",
      hostedProjectRef:
        Deno.env.get("AGENT_WORK_HOSTED_PROJECT_REF")?.trim(),
    },
  );
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpcArray(
  client: RpcClient,
  name:
    | "requeue_expired_agent_work_leases"
    | "wake_due_agent_work_steps",
  invocation: SweepInvocation,
): Promise<SweeperEntity[]> {
  const { data, error } = await client.rpc(name, {
    p_now: invocation.now,
    p_max_items_per_pass: invocation.maxItemsPerPass,
  });
  if (error) throw new Error("rpc_failed");
  return Array.isArray(data) ? data as SweeperEntity[] : [];
}

async function rpcApprovalSweep(
  client: RpcClient,
  invocation: SweepInvocation,
): Promise<ApprovalSweepResult> {
  const { data, error } = await client.rpc("expire_agent_work_approvals", {
    p_now: invocation.now,
    p_max_items_per_pass: invocation.maxItemsPerPass,
  });
  if (error) throw new Error("rpc_failed");
  if (!data || typeof data !== "object") {
    return { expired: [], skippedCurrent: [] };
  }
  const result = data as Record<string, unknown>;
  return {
    expired: Array.isArray(result.expired)
      ? result.expired as SweeperEntity[]
      : [],
    skippedCurrent: Array.isArray(result.skippedCurrent)
      ? result.skippedCurrent as SweeperEntity[]
      : [],
  };
}

async function rpcPoisonSweep(
  client: RpcClient,
  invocation: SweepInvocation,
): Promise<PoisonSweepResult> {
  const { data, error } = await client.rpc(
    "archive_agent_work_poison_messages",
    {
      p_now: invocation.now,
      p_max_items_per_pass: invocation.maxItemsPerPass,
    },
  );
  if (error) throw new Error("rpc_failed");
  if (!data || typeof data !== "object") {
    return { archived: [], retryCeiling: [] };
  }
  const result = data as Record<string, unknown>;
  return {
    archived: Array.isArray(result.archived)
      ? result.archived as SweeperEntity[]
      : [],
    retryCeiling: Array.isArray(result.retryCeiling)
      ? result.retryCeiling as SweeperEntity[]
      : [],
  };
}

function createRuntimeHandler(): (request: Request) => Promise<Response> {
  let client: RpcClient | null = null;
  const getClient = () => client ??= createServiceClient();
  return createAgentWorkSweeperHandler({
    getCorsHeaders: corsHeadersForRequest,
    getInvocationSecret: () =>
      Deno.env.get("AGENT_WORK_SWEEPER_SECRET")?.trim() ?? "",
    getGatewayApiKeys: configuredGatewayApiKeys,
    getRuntimeMode: async () => {
      const configuredMode = runtimeMode();
      if (!ALLOWED_RUNTIME_MODES.has(configuredMode)) return "disabled";

      const { data, error } = await getClient().rpc(
        "load_agent_work_runtime_policy",
        { p_mode_input: configuredMode },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (
        error || !row || row.authoritative !== true ||
        typeof row.runtimeMode !== "string" ||
        typeof row.actionsDisabled !== "boolean" ||
        typeof row.killSwitchEnabled !== "boolean"
      ) {
        throw new Error("runtime_policy_unavailable");
      }
      if (row.actionsDisabled || row.killSwitchEnabled) return "disabled";
      return ALLOWED_RUNTIME_MODES.has(row.runtimeMode)
        ? row.runtimeMode
        : "disabled";
    },
    getNow: () => new Date(),
    getMaxItemsPerPass: () => DEFAULT_MAX_ITEMS_PER_PASS,
    requeueExpiredLeases: (invocation) =>
      rpcArray(
        getClient(),
        "requeue_expired_agent_work_leases",
        invocation,
      ),
    wakeDueWaitingSteps: (invocation) =>
      rpcArray(getClient(), "wake_due_agent_work_steps", invocation),
    expireApprovals: (invocation) => rpcApprovalSweep(getClient(), invocation),
    archivePoisonMessages: (invocation) =>
      rpcPoisonSweep(getClient(), invocation),
    emitSanitizedAlert: async () => {},
    executeClinicalEffect: async () => {},
  });
}

function configuredGatewayApiKeys(): string[] {
  return resolveAgentWorkGatewayApiKeys({
    SUPABASE_PUBLISHABLE_KEYS: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
    SUPABASE_PUBLISHABLE_KEY: Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
  });
}

const handler = (request: Request) => createRuntimeHandler()(request);

if (import.meta.main) {
  Deno.serve(handler);
}

export default handler;
