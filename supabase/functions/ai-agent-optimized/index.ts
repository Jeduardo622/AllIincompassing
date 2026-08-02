import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { resolveOrgId } from "../_shared/org.ts";
import { getLogger } from "../_shared/logging.ts";
import { errorEnvelope, getRequestId, IsoDateSchema } from "../lib/http/error.ts";
import { persistChatMessage } from "./persistence.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import {
  resolveAgentRole,
  type AgentRole,
} from "./roleResolution.ts";
import type {
  AgentWorkModelAttemptAuthority,
  AgentWorkModelAttemptSnapshot,
  AgentWorkModelCorrelation,
  AssessmentRemediationSuggestion,
} from "../_shared/agent-work/contracts.ts";
import {
  validateAssessmentRemediationSuggestion,
  validateModelAttemptScope,
} from "../_shared/agent-work/policy.ts";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

interface OptimizedAIResponse {
  response: string;
  action?: {
    type: string;
    data: Record<string, unknown>;
  };
  conversationId?: string;
  cacheHit?: boolean;
  responseTime?: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  suggestions?: Array<{
    type: string;
    message: string;
    confidence: number;
  }>;
  candidateEvidence?: AssessmentRemediationSuggestion;
}

class AgentUpstreamUnavailableError extends Error {
  readonly code = "upstream_unavailable";

  constructor() {
    super("AI service is temporarily unavailable");
    this.name = "AgentUpstreamUnavailableError";
  }
}

class AgentLedgerPolicyError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super("Ledger-bound advisory request was denied");
    this.name = "AgentLedgerPolicyError";
  }
}

const isInsufficientQuotaError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  const candidate = error as Record<string, unknown>;
  const nested =
    candidate.error && typeof candidate.error === "object"
      ? candidate.error as Record<string, unknown>
      : null;
  const providerCodes = [
    candidate.code,
    candidate.type,
    nested?.code,
    nested?.type,
  ];

  return candidate.status === 429 && providerCodes.includes("insufficient_quota");
};

type ToolExecutionMode = "server_execute" | "client_handoff" | "suggestion_only";

type ExecutionGate = {
  role: AgentRole;
  allowedTools: string[];
  deniedTools: string[];
  killSwitchEnabled: boolean;
  killSwitchReason?: string;
  killSwitchSource?: "env" | "db";
};

type PromptToolVersion = {
  id: string;
  promptVersion: string;
  toolVersion: string;
  status: string;
  isCurrent: boolean;
  metadata?: Record<string, unknown> | null;
  rollbackReason?: string | null;
  createdAt?: string | null;
};

type TraceContext = {
  requestId: string;
  correlationId: string;
  agentOperationId?: string | null;
  conversationId?: string;
  userId?: string | null;
  orgId?: string | null;
  workItemId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
};

type TraceStep = {
  stepName: string;
  status: "ok" | "blocked" | "error";
  payload?: Record<string, unknown>;
};

const UuidSchema = z.string().uuid();
const AgentWorkRequestSchema = z.object({
  organizationId: UuidSchema,
  clientId: UuidSchema.nullable(),
  workItemId: UuidSchema,
  stepId: UuidSchema,
  attemptId: UuidSchema,
  workflowVersion: z.number().int().positive(),
  correlationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
}).strict();

const AgentRequestSchema = z.object({
  message: z.string().min(1).max(4000).optional(),
  agentWork: AgentWorkRequestSchema.optional(),
  context: z
    .object({
      url: z.string().url().max(2048).optional(),
      userAgent: z.string().max(512).optional(),
      conversationId: UuidSchema.optional(),
      replaySeed: z.number().int().nonnegative().max(1_000_000_000).optional(),
      actor: z
        .object({
          id: UuidSchema.optional(),
          role: z.string().optional(),
        })
        .optional(),
      guardrails: z
        .object({
          allowedTools: z.array(z.string()).optional(),
          audit: z.unknown().optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),
}).strict().superRefine((value, ctx) => {
  if (value.agentWork && value.message !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "Ledger-bound requests accept code and identifier inputs only",
    });
  }
  if (value.agentWork && value.context !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["context"],
      message: "Ledger-bound requests do not accept free-form context",
    });
  }
  if (!value.agentWork && value.message === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "Message is required for non-ledger requests",
    });
  }
});

const SESSION_TOOL_REGISTRY: Record<
  string,
  { roles: AgentRole[]; executionMode: ToolExecutionMode }
> = {
  schedule_session: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "client_handoff",
  },
  cancel_sessions: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "client_handoff",
  },
  start_session: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "client_handoff",
  },
  predict_conflicts: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "suggestion_only",
  },
  suggest_optimal_times: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "suggestion_only",
  },
  get_monthly_session_count: {
    roles: ["therapist", "admin", "bcba", "super_admin"],
    executionMode: "server_execute",
  },
};

const CONTROL_CHARS = /[\p{C}]/gu;

// ============================================================================
// OPTIMIZED AI CONFIGURATION (Phase 4)
// Updated: Fixed buildContext reference issue
// ============================================================================

// Enhanced GPT-4o configuration for business logic
const OPTIMIZED_AI_CONFIG = {
  model: "gpt-4o",                    // Full GPT-4o for complex reasoning
  temperature: 0.3,                   // Lower temperature for consistent business decisions
  max_tokens: 1000,                   // Increased token allocation
  top_p: 0.9,                         // Nucleus sampling for quality
  frequency_penalty: 0.1,             // Reduce repetitive responses
  presence_penalty: 0.1,              // Encourage diverse solutions
  stream: false,                      // Enable for real-time in production
};

// Compressed system prompt for token efficiency
const OPTIMIZED_SYSTEM_PROMPT = `You are an AI assistant focused on session operations for ABA practices.

ACTIONS: schedule sessions, cancel sessions, start sessions, and provide session count summaries.
INTELLIGENCE: detect conflicts, suggest safer alternatives, and surface retry guidance.
SAFETY: follow role-scoped tool access and never invent write actions outside the provided tools.

BEHAVIOR:
- Be concise and operational.
- Prefer conflict-safe recommendations over risky changes.
- If details are missing, ask for the minimum required session data.
- Use ISO datetime output when proposing schedule actions.

DATETIME: Use ISO format (YYYY-MM-DD). "Today"=${new Date().toISOString().split('T')[0]}, "tomorrow"=${new Date(Date.now() + 86400000).toISOString().split('T')[0]}`;

// ============================================================================
// COMPRESSED FUNCTION SCHEMAS (Token Optimized)
// ============================================================================

const compressedFunctionSchemas = [
  {
    type: "function",
    function: {
      name: "schedule_session",
      description: "Prepare scheduling details for a single therapy session",
      parameters: {
        type: "object",
        properties: {
          therapist_id: { type: "string" },
          client_id: { type: "string" },
          start_time: { type: "string", format: "date-time" },
          end_time: { type: "string", format: "date-time" },
          location_type: { type: "string", enum: ["in_clinic", "in_home", "telehealth"], default: "in_clinic" }
        },
        required: ["therapist_id", "client_id", "start_time", "end_time"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_sessions",
      description: "Cancel sessions by date/therapist",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", format: "date" },
          therapist_id: { type: "string", description: "Optional filter" },
          reason: { type: "string", default: "Cancelled" }
        },
        required: ["date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_session",
      description: "Start an existing scheduled session",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          program_id: { type: "string" },
          goal_id: { type: "string" },
          goal_ids: {
            type: "array",
            items: { type: "string" },
          },
          started_at: { type: "string", format: "date-time" },
        },
        required: ["session_id", "program_id", "goal_id"],
      }
    }
  },
  {
    type: "function",
    function: {
      name: "predict_conflicts",
      description: "Detect upcoming scheduling conflicts",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", format: "date" },
          end_date: { type: "string", format: "date" },
          include_suggestions: { type: "boolean", default: true }
        },
        required: ["start_date", "end_date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "suggest_optimal_times",
      description: "AI recommendations for optimal scheduling",
      parameters: {
        type: "object",
        properties: {
          therapist_id: { type: "string" },
          client_id: { type: "string" },
          duration: { type: "integer", default: 60 },
          date_range: { type: "string", default: "+7 days" }
        },
        required: ["therapist_id", "client_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_monthly_session_count",
      description: "Get total number of sessions for a specified date range",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", format: "date", description: "Start date (YYYY-MM-DD)" },
          end_date: { type: "string", format: "date", description: "End date (YYYY-MM-DD)" },
          therapist_id: { type: "string", description: "Optional filter by therapist" },
          client_id: { type: "string", description: "Optional filter by client" },
          status: { type: "string", description: "Optional filter by status" }
        },
        required: ["start_date", "end_date"]
      }
    }
  }
];

const TOOL_SCHEMA_MAP = new Map(
  compressedFunctionSchemas.map((schema: any) => [schema.function.name as string, schema])
);
const KNOWN_TOOL_NAMES = new Set<string>(Array.from(TOOL_SCHEMA_MAP.keys()));

const parseBoolean = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const resolveActorRole = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string | null,
): Promise<AgentRole> => {
  return resolveAgentRole(
    async (role) => {
      if (role === "super_admin") {
        const { data, error } = await db.rpc("current_user_is_super_admin");
        if (error) throw error;
        return data === true;
      }
      if (!orgId) return false;

      const roleNames = role === "admin" ? ["org_super_admin", "admin"] : [role];
      for (const roleName of roleNames) {
        const { data, error } = await db.rpc("user_has_role_for_org", {
          role_name: roleName,
          target_organization_id: orgId,
        });
        if (error) throw error;
        if (data === true) return true;
      }
      return false;
    },
    (error) => {
      console.warn("agent_role_resolution_failed");
    },
  );
};

const resolveExecutionGate = (role: AgentRole, requestedTools: string[] = []): Omit<ExecutionGate, "killSwitchEnabled" | "killSwitchReason" | "killSwitchSource"> => {
  const roleTools = Object.entries(SESSION_TOOL_REGISTRY)
    .filter(([, metadata]) => metadata.roles.includes(role))
    .map(([tool]) => tool)
    .filter((tool) => KNOWN_TOOL_NAMES.has(tool));
  const requested = requestedTools.filter((tool) => KNOWN_TOOL_NAMES.has(tool));
  if (requested.length === 0) {
    return { role, allowedTools: roleTools, deniedTools: [] };
  }
  const allowedTools = requested.filter((tool) => roleTools.includes(tool));
  const deniedTools = requested.filter((tool) => !roleTools.includes(tool));
  return { role, allowedTools, deniedTools };
};

const selectToolSchemas = (allowedTools: string[]): Array<Record<string, unknown>> =>
  allowedTools.map((tool) => TOOL_SCHEMA_MAP.get(tool)).filter(Boolean) as Array<Record<string, unknown>>;

const sanitizeText = (value: string, maxLength: number): string =>
  value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const resolveKillSwitch = async (): Promise<Pick<ExecutionGate, "killSwitchEnabled" | "killSwitchReason" | "killSwitchSource">> => {
  if (parseBoolean(Deno.env.get("AGENT_ACTIONS_DISABLED"))) {
    return { killSwitchEnabled: true, killSwitchReason: "actions_disabled", killSwitchSource: "env" };
  }
  const { data, error } = await supabaseAdmin
    .from("agent_runtime_config")
    .select("actions_disabled, reason")
    .eq("config_key", "global")
    .maybeSingle();
  if (error) {
    console.warn("agent_runtime_config_unavailable");
    return {
      killSwitchEnabled: true,
      killSwitchReason: "runtime_policy_unavailable",
      killSwitchSource: "db",
    };
  }
  if (data?.actions_disabled) {
    return {
      killSwitchEnabled: true,
      killSwitchReason: data.reason ?? "actions_disabled",
      killSwitchSource: "db",
    };
  }
  return { killSwitchEnabled: false };
};

const resolvePromptToolVersion = async (): Promise<{ version: PromptToolVersion | null; error?: string }> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_prompt_tool_versions")
      .select("id, prompt_version, tool_version, status, is_current, metadata, rollback_reason, created_at")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return { version: null, error: "prompt_tool_version_query_failed" };
    }
    if (!data) {
      return { version: null };
    }
    return {
      version: {
        id: data.id,
        promptVersion: data.prompt_version,
        toolVersion: data.tool_version,
        status: data.status,
        isCurrent: data.is_current,
        metadata: data.metadata,
        rollbackReason: data.rollback_reason,
        createdAt: data.created_at,
      },
    };
  } catch (error) {
    return { version: null, error: "prompt_tool_version_query_failed" };
  }
};

const insertAgentTrace = async (
  ctx: TraceContext,
  step: TraceStep,
  stepIndex: number
): Promise<void> => {
  try {
    await supabaseAdmin.from("agent_execution_traces").insert({
      request_id: ctx.requestId,
      correlation_id: ctx.correlationId,
      conversation_id: ctx.conversationId ?? null,
      user_id: ctx.userId ?? null,
      organization_id: ctx.orgId ?? null,
      work_item_id: ctx.workItemId ?? null,
      step_id: ctx.stepId ?? null,
      attempt_id: ctx.attemptId ?? null,
      step_name: step.stepName,
      step_index: stepIndex,
      status: step.status,
      payload: step.payload ?? null,
      replay_payload: null,
    });
  } catch (error) {
    console.warn("agent_trace_insert_failed");
  }
};

const buildActionBlockedMessage = (reason: string): string =>
  `Note: Requested action was not executed (${reason}). No changes were made.`;

// ============================================================================
// INTELLIGENT CACHING SYSTEM
// ============================================================================

const AI_CACHE_CONFIG = {
  // Cache durations by query type
  FUNCTION_RESULTS: {
    schedule_operations: 5 * 60 * 1000,      // 5 minutes
    data_lookups: 15 * 60 * 1000,           // 15 minutes
    workload_analysis: 30 * 60 * 1000,      // 30 minutes
  },
  RESPONSE_PATTERNS: {
    common_queries: 60 * 60 * 1000,         // 1 hour
    confirmations: 30 * 60 * 1000,          // 30 minutes
  },
  CONTEXT_DATA: {
    user_preferences: 24 * 60 * 60 * 1000,  // 24 hours
    entity_summaries: 10 * 60 * 1000,       // 10 minutes
  }
};

async function generateSemanticCacheKey(
  query: string,
  context: Record<string, unknown>
): Promise<string> {
  const contextHash = JSON.stringify({
    userRole: (context as any).userRole || 'user',
    page: (context as any).currentPage || 'unknown'
  });

  const requestClient = createRequestClient((globalThis as any).currentRequest);
  await getUserOrThrow(requestClient);
  const { data, error } = await supabaseAdmin.rpc('generate_semantic_cache_key', {
    p_query_text: query,
    p_context_hash: contextHash
  } as any);

  if (error) {
    console.warn('Service role cache key generation failed:', error.message);
  }

  return (data as any) || `ai_${Date.now()}`;
}

async function checkCachedResponse(cacheKey: string): Promise<string | null> {
  try {
    const requestClient = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(requestClient);
    const { data, error } = await supabaseAdmin.rpc('get_cached_ai_response', {
      p_cache_key: cacheKey
    } as any);

    if (error) {
      throw error;
    }

    return (data as any)?.[0]?.response_text || null;
  } catch (error) {
    console.warn('Cache check failed:', error);
    return null;
  }
}

async function cacheAIResponse(
  cacheKey: string,
  query: string,
  response: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const requestClient = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(requestClient);
    const { error } = await supabaseAdmin.rpc('cache_ai_response', {
      p_cache_key: cacheKey,
      p_query_text: query,
      p_response_text: response,
      p_metadata: metadata,
      p_expires_at: new Date(Date.now() + AI_CACHE_CONFIG.RESPONSE_PATTERNS.common_queries)
    } as any);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn('Cache storage failed:', error);
  }
}

// ============================================================================
// CONTEXT OPTIMIZATION
// ============================================================================

interface ContextData {
  therapists?: Array<{ id: string }>;
  clients?: Array<{ id: string }>;
  todaySessions?: Array<{ id: string }>;
}

interface ChatMessage {
  role: string;
  content: string;
}

async function buildOptimizedContext(userRoles: string[], conversationId?: string) {
  try {
    // Parallel data fetching for efficiency
    const [contextData, recentHistory] = await Promise.all([
      getCompressedContextData(),
      getOptimizedChatHistory(conversationId)
    ]);

    return {
      summary: {
        therapists: (contextData as any).therapists?.length || 0,
        clients: (contextData as any).clients?.length || 0,
        todaySessions: (contextData as any).todaySessions?.length || 0,
        userRole: userRoles[0] || 'user'
      },
      recentActions: (recentHistory as any).slice(0, 3),
      currentTime: new Date().toISOString(),
    } as any;
  } catch (error) {
    console.warn('Context building failed:', error);
    return { summary: { userRole: 'user' }, recentActions: [] } as any;
  }
}

async function getCompressedContextData(): Promise<ContextData> {
  // Use optimized queries
  try {
    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);
    const { data } = await db.rpc('get_dropdown_data');
    return (data as any) || {};
  } catch {
    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);
    const [therapists, clients, sessions] = await Promise.all([
      db.from('therapists').select('id').eq('status', 'active').is('deleted_at', null),
      db.from('clients').select('id').is('deleted_at', null),
      db.from('sessions').select('id').gte('start_time', new Date().toISOString().split('T')[0])
    ]);

    return {
      therapists: (therapists as any).data || [],
      clients: (clients as any).data || [],
      todaySessions: (sessions as any).data || []
    } as any;
  }
}

async function getOptimizedChatHistory(conversationId?: string): Promise<ChatMessage[]> {
  if (!conversationId) return [] as any;

  try {
    const db = createRequestClient((globalThis as any).currentRequest);
    const user = await getUserOrThrow(db);
    const { data, error } = await db
      .from('chat_history')
      .select('role, content, created_at')
      .eq('user_id', user.id)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;

    return ((data as any) || []).reverse();
  } catch (error) {
    console.warn('Chat history fetch failed:', error);
    return [] as any;
  }
}

// ============================================================================
// PREDICTIVE AI CAPABILITIES
// ============================================================================

interface Suggestion {
  type: string;
  message: string;
  confidence: number;
  action?: string;
}

async function generateProactiveSuggestions(context: { summary?: { userRole?: string } }): Promise<Suggestion[]> {
  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);
    const { data: conflicts } = await db.rpc('detect_scheduling_conflicts', {
      p_start_date: tomorrow,
      p_end_date: nextWeek,
      p_include_suggestions: false
    } as any);

    const suggestions: Suggestion[] = [];

    if (conflicts && (conflicts as any).length > 0) {
      suggestions.push({
        type: 'conflict_warning',
        message: `${(conflicts as any).length} potential scheduling conflicts detected in the next week`,
        confidence: 0.9,
        action: 'predict_conflicts'
      });
    }

    return suggestions as any;
  } catch (error) {
    console.warn('Suggestion generation failed:', error);
    return [] as any;
  }
}

// ============================================================================
// OPTIMIZED AI PROCESSING
// ============================================================================

type LedgerAgentWorkInput = z.infer<typeof AgentWorkRequestSchema>;

const LEDGER_MODEL_REQUEST_SCHEMA_VERSION = "assessment-remediation-code-only-v1";
const LEDGER_PRICING_VERSION = "gpt-4o-estimate-v1";
const LEDGER_PROVIDER = "openai";
const configuredAgentWorkRuntimeMode = (): "disabled" | "shadow" | "advisory" => {
  const value = (Deno.env.get("AGENT_WORK_LEDGER_RUNTIME_MODE") ?? "disabled")
    .trim()
    .toLowerCase();
  return value === "shadow" || value === "advisory" ? value : "disabled";
};

const loadLedgerRuntimePolicy = async (): Promise<"advisory"> => {
  const { data, error } = await supabaseAdmin.rpc(
    "load_agent_work_runtime_policy",
    { p_mode_input: configuredAgentWorkRuntimeMode() },
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
    throw new AgentLedgerPolicyError("runtime_policy_unavailable", 503);
  }
  if (
    row.actionsDisabled || row.killSwitchEnabled ||
    row.runtimeMode !== "advisory"
  ) {
    throw new AgentLedgerPolicyError("runtime_mode_not_advisory");
  }
  return "advisory";
};

const mapModelAttemptAuthority = (
  row: Record<string, unknown>,
  correlationId: string,
): AgentWorkModelAttemptAuthority => ({
  organizationId: String(row.organization_id ?? ""),
  clientId: row.client_id === null ? null : String(row.client_id ?? ""),
  workItemId: String(row.work_item_id ?? ""),
  stepId: String(row.step_id ?? ""),
  attemptId: String(row.attempt_id ?? ""),
  workflowKey: String(row.workflow_key ?? ""),
  workflowVersion: Number(row.workflow_version),
  stepKey: String(row.step_key ?? ""),
  attemptStatus: String(row.attempt_status ?? "") as "running",
  promptVersion: typeof row.prompt_version === "string" ? row.prompt_version : null,
  toolVersion: typeof row.tool_version === "string" ? row.tool_version : null,
  allowedTools: Array.isArray(row.allowed_tools)
    ? row.allowed_tools.filter((tool): tool is string => typeof tool === "string")
    : [],
  guardedTools: Array.isArray(row.guarded_tools)
    ? row.guarded_tools.filter((tool): tool is string => typeof tool === "string")
    : [],
  blockerCodes: Array.isArray(row.blocker_codes)
    ? row.blocker_codes.filter((code): code is string => typeof code === "string")
    : [],
  suggestedActionCodes: Array.isArray(row.suggested_action_codes)
    ? row.suggested_action_codes.filter((code): code is string => typeof code === "string")
    : [],
  evidenceSourceIds: Array.isArray(row.evidence_source_ids)
    ? row.evidence_source_ids.filter((id): id is string => typeof id === "string")
    : [],
  correlationId,
});

const estimateLedgerModelCost = (inputTokens: number, outputTokens: number): number =>
  Number(((inputTokens * 2.5 + outputTokens * 10) / 1_000_000).toFixed(8));

async function recordLedgerModelResult(
  agentWork: LedgerAgentWorkInput,
  actorUserId: string,
  inputTokens: number,
  outputTokens: number,
  errorClass: string | null,
  errorCode: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "record_agent_work_model_attempt_result",
    {
      p_actor_user_id: actorUserId,
      p_organization_id: agentWork.organizationId,
      p_client_id: agentWork.clientId,
      p_work_item_id: agentWork.workItemId,
      p_step_id: agentWork.stepId,
      p_attempt_id: agentWork.attemptId,
      p_input_token_count: inputTokens,
      p_output_token_count: outputTokens,
      p_computed_cost: estimateLedgerModelCost(inputTokens, outputTokens),
      p_error_class: errorClass,
      p_error_code: errorCode,
    },
  );
  if (error) {
    throw new AgentLedgerPolicyError("attempt_result_recording_failed", 503);
  }
}

async function processLedgerRemediation(
  agentWork: LedgerAgentWorkInput,
  actorUserId: string,
  requestId: string,
  promptToolVersion: PromptToolVersion,
  trace: (step: TraceStep) => Promise<void>,
): Promise<OptimizedAIResponse> {
  await loadLedgerRuntimePolicy();

  if (
    promptToolVersion.status !== "active" || !promptToolVersion.isCurrent
  ) {
    throw new AgentLedgerPolicyError("prompt_tool_version_unavailable", 503);
  }

  const snapshot: AgentWorkModelAttemptSnapshot = {
    provider: LEDGER_PROVIDER,
    model: OPTIMIZED_AI_CONFIG.model,
    promptVersion: promptToolVersion.promptVersion,
    toolVersion: promptToolVersion.toolVersion,
    workflowVersion: agentWork.workflowVersion,
    temperature: OPTIMIZED_AI_CONFIG.temperature,
    modelRequestSchemaVersion: LEDGER_MODEL_REQUEST_SCHEMA_VERSION,
    pricingVersion: LEDGER_PRICING_VERSION,
  };
  const correlation: AgentWorkModelCorrelation = {
    organizationId: agentWork.organizationId,
    clientId: agentWork.clientId,
    workItemId: agentWork.workItemId,
    stepId: agentWork.stepId,
    attemptId: agentWork.attemptId,
    workflowVersion: agentWork.workflowVersion,
    correlationId: agentWork.correlationId,
  };

  const { data: snapshotRows, error: snapshotError } = await supabaseAdmin.rpc(
    "snapshot_agent_work_model_attempt",
    {
      p_actor_user_id: actorUserId,
      p_organization_id: agentWork.organizationId,
      p_client_id: agentWork.clientId,
      p_work_item_id: agentWork.workItemId,
      p_step_id: agentWork.stepId,
      p_attempt_id: agentWork.attemptId,
      p_workflow_version: agentWork.workflowVersion,
      p_correlation_id: agentWork.correlationId,
      p_request_id: requestId,
      p_provider: snapshot.provider,
      p_model: snapshot.model,
      p_prompt_version: snapshot.promptVersion,
      p_tool_version: snapshot.toolVersion,
      p_temperature: snapshot.temperature,
      p_model_request_schema_version: snapshot.modelRequestSchemaVersion,
      p_pricing_version: snapshot.pricingVersion,
    },
  );
  const snapshotRow = Array.isArray(snapshotRows)
    ? snapshotRows[0] as Record<string, unknown> | undefined
    : undefined;
  if (snapshotError || !snapshotRow) {
    throw new AgentLedgerPolicyError("attempt_snapshot_denied");
  }
  const authority = mapModelAttemptAuthority(snapshotRow, agentWork.correlationId);
  const scopeDecision = validateModelAttemptScope(correlation, authority);
  if (!scopeDecision.allowed) {
    throw new AgentLedgerPolicyError(scopeDecision.reasonCode);
  }

  await trace({
    stepName: "request.received",
    status: "ok",
    payload: {
      attemptId: agentWork.attemptId,
      guardrailResult: "authoritative_scope_verified",
      outcome: "ledger_scope_verified",
    },
  });
  await trace({
    stepName: "llm.attempt.snapshot",
    status: "ok",
    payload: {
      attemptId: agentWork.attemptId,
      provider: snapshot.provider,
      model: snapshot.model,
      promptVersion: snapshot.promptVersion,
      toolVersion: snapshot.toolVersion,
      modelRequestSchemaVersion: snapshot.modelRequestSchemaVersion,
      pricingVersion: snapshot.pricingVersion,
      guardrailResult: "allowed",
      outcome: "provider_pending",
    },
  });

  const startedAt = performance.now();
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const completion = await openai.chat.completions.create({
      model: snapshot.model,
      temperature: snapshot.temperature,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: "Return one advisory remediation candidate as strict JSON. Use only supplied codes and UUID evidence identifiers. Set requiresHumanReview to true. Do not claim completion, approval, publication, signature, billing, submission, final-record creation, or clinical mutation.",
        },
        {
          role: "user",
          content: JSON.stringify({
            blockerCodes: authority.blockerCodes,
            suggestedActionCodes: authority.suggestedActionCodes,
            evidenceSourceIds: authority.evidenceSourceIds,
          }),
        },
      ],
      tools: [],
      response_format: { type: "json_object" },
    } as any);
    inputTokens = Math.max(0, Number((completion as any).usage?.prompt_tokens ?? 0));
    outputTokens = Math.max(0, Number((completion as any).usage?.completion_tokens ?? 0));
    const content = completion.choices[0]?.message?.content;
    let parsed: unknown = null;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : null;
    } catch {
      parsed = null;
    }
    const outputDecision = validateAssessmentRemediationSuggestion(parsed, {
      blockerCodes: authority.blockerCodes,
      suggestedActionCodes: authority.suggestedActionCodes,
      evidenceSourceIds: authority.evidenceSourceIds,
    });
    if (!outputDecision.allowed || !outputDecision.suggestion) {
      await recordLedgerModelResult(
        agentWork,
        actorUserId,
        inputTokens,
        outputTokens,
        "model_output",
        outputDecision.reasonCode,
      );
      throw new AgentLedgerPolicyError(outputDecision.reasonCode, 502);
    }

    await recordLedgerModelResult(
      agentWork,
      actorUserId,
      inputTokens,
      outputTokens,
      null,
      null,
    );
    await trace({
      stepName: "llm.response.received",
      status: "ok",
      payload: {
        attemptId: agentWork.attemptId,
        provider: snapshot.provider,
        model: snapshot.model,
        latencyMs: performance.now() - startedAt,
        tokenUsage: { input: inputTokens, output: outputTokens },
        computedCost: estimateLedgerModelCost(inputTokens, outputTokens),
        pricingVersion: snapshot.pricingVersion,
        guardrailResult: "allowed",
        outcome: "candidate_evidence",
      },
    });
    return {
      response: "Advisory candidate evidence generated for human review.",
      candidateEvidence: outputDecision.suggestion,
      tokenUsage: {
        prompt: inputTokens,
        completion: outputTokens,
        total: inputTokens + outputTokens,
      },
      responseTime: performance.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof AgentLedgerPolicyError) throw error;
    const errorCode = isInsufficientQuotaError(error)
      ? "insufficient_quota"
      : "upstream_unavailable";
    await recordLedgerModelResult(
      agentWork,
      actorUserId,
      inputTokens,
      outputTokens,
      "provider",
      errorCode,
    );
    await trace({
      stepName: "llm.response.received",
      status: "error",
      payload: {
        attemptId: agentWork.attemptId,
        provider: snapshot.provider,
        model: snapshot.model,
        latencyMs: performance.now() - startedAt,
        tokenUsage: { input: inputTokens, output: outputTokens },
        errorClass: "provider",
        errorCode,
        guardrailResult: "provider_error",
        outcome: "no_candidate_evidence",
      },
    });
    throw new AgentUpstreamUnavailableError();
  }
}

async function processOptimizedMessage(
  message: string,
  context: Record<string, unknown>,
  executionGate: ExecutionGate,
  trace: (step: TraceStep) => Promise<void>,
  traceContext: TraceContext
): Promise<OptimizedAIResponse> {
  const startTime = performance.now();
  console.log("Processing message with context:", JSON.stringify({
    message_length: message.length,
    has_conversation_id: !!(context as any).conversationId,
    conversation_id: (context as any).conversationId
  }));

  try {
    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);

    const cacheKey = await generateSemanticCacheKey(message, context);
    await trace({
      stepName: "cache.key.generated",
      status: "ok",
      payload: { cacheKey },
    });
    const cachedResponse = await checkCachedResponse(cacheKey);

    if (cachedResponse) {
      await trace({
        stepName: "cache.hit",
        status: "ok",
        payload: { cacheKey },
      });
      return {
        response: cachedResponse,
        cacheHit: true,
        responseTime: performance.now() - startTime
      } as any;
    }

    const optimizedContext = await buildOptimizedContext((context as any).userRoles as string[] || [], (context as any).conversationId as string);
    console.log("Built optimized context with history items:", (optimizedContext as any).recentActions?.length || 0);

    const suggestions = await generateProactiveSuggestions(optimizedContext as any);

    const contextPrompt = `CONTEXT: ${JSON.stringify((optimizedContext as any).summary)}\nRECENT: ${((optimizedContext as any).recentActions as any).map((a: any) => `${a.role}: ${a.content}`).join('; ')}\nTIME: ${(optimizedContext as any).currentTime}`;

    const allowedToolSchemas = executionGate.killSwitchEnabled
      ? []
      : selectToolSchemas(executionGate.allowedTools);
    const replaySeed =
      typeof (context as any).replaySeed === 'number'
        ? (context as any).replaySeed
        : undefined;

    const completion = await openai.chat.completions.create({
      ...OPTIMIZED_AI_CONFIG as any,
      ...(replaySeed !== undefined ? { seed: replaySeed } : {}),
      messages: [
        { role: 'system', content: OPTIMIZED_SYSTEM_PROMPT },
        { role: 'system', content: contextPrompt },
        { role: 'user', content: message }
      ],
      tools: allowedToolSchemas as any
    } as any);

    const responseMessage = completion.choices[0].message as any;
    const responseTime = performance.now() - startTime;
    await trace({
      stepName: "llm.response.received",
      status: "ok",
      payload: {
        responseTimeMs: responseTime,
        toolCallCount: responseMessage.tool_calls?.length ?? 0,
        tokenUsage: (completion as any).usage ?? null,
        replaySeed: replaySeed ?? null,
      },
    });

    const conversationId = (context as any).conversationId as string ||
                          (await saveChatMessage('user', message, context)).toString();

    let action: any;
    let actionBlockedReason: string | null = null;
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      let functionArgs: Record<string, unknown> = {};
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        const toolSchema = TOOL_SCHEMA_MAP.get(functionName);
        if (toolSchema?.function?.parameters) {
          const argsSchema = z
            .object((toolSchema.function.parameters as any)?.properties ?? {})
            .passthrough();
          const validatedArgs = argsSchema.safeParse(parsedArgs);
          if (!validatedArgs.success) {
            throw new Error('Invalid tool arguments');
          }
          functionArgs = validatedArgs.data as Record<string, unknown>;
        } else {
          functionArgs = parsedArgs as Record<string, unknown>;
        }
      } catch (error) {
        await trace({
          stepName: "tool.args.parse_failed",
          status: "error",
          payload: { toolName: functionName, errorCode: "invalid_tool_payload" },
        });
        actionBlockedReason = "invalid_tool_payload";
      }

      if (functionArgs.date === 'today') {
        functionArgs.date = new Date().toISOString().split('T')[0];
      } else if (functionArgs.date === 'tomorrow') {
        functionArgs.date = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      }
      if (typeof functionArgs.date === 'string') {
        const dateCheck = IsoDateSchema.safeParse(functionArgs.date);
        if (!dateCheck.success) {
          actionBlockedReason = 'invalid_tool_payload';
        }
      }

      const executionMode = SESSION_TOOL_REGISTRY[functionName]?.executionMode ?? "client_handoff";
      const toolAllowed = executionGate.allowedTools.includes(functionName);
      if (executionGate.killSwitchEnabled) {
        actionBlockedReason = executionGate.killSwitchReason ?? "actions_disabled";
      } else if (!KNOWN_TOOL_NAMES.has(functionName)) {
        actionBlockedReason = "tool_not_registered";
      } else if (!toolAllowed) {
        actionBlockedReason = "tool_not_permitted";
      }

      if (actionBlockedReason) {
        await trace({
          stepName: "tool.execution.blocked",
          status: "blocked",
          payload: {
            toolName: functionName,
            reason: actionBlockedReason,
            role: executionGate.role,
            allowedTools: executionGate.allowedTools,
            deniedTools: executionGate.deniedTools,
          },
        });
        action = null as any;
      } else if (functionName === "get_monthly_session_count") {
        try {
          const { start_date, end_date, therapist_id, client_id, status } = functionArgs;

          const { data: sessionData, error } = await db.rpc('get_session_metrics', {
            p_start_date: start_date,
            p_end_date: end_date,
            p_therapist_id: therapist_id || null,
            p_client_id: client_id || null,
            p_status: status || null
          } as any);

          if (error) throw error;

          const startDateObj = new Date(start_date);
          const endDateObj = new Date(end_date);
          const sameMonth = startDateObj.getMonth() === endDateObj.getMonth() &&
                            startDateObj.getFullYear() === endDateObj.getFullYear();

          const monthName = startDateObj.toLocaleString('default', { month: 'long' });
          const dateRangeText = sameMonth
            ? `${monthName} ${startDateObj.getFullYear()}`
            : `${startDateObj.toLocaleDateString('default', { month: 'short', day: 'numeric' })} to ${endDateObj.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;

          const totalSessions = (sessionData as any)?.totalSessions || 0;
          const completedSessions = (sessionData as any)?.completedSessions || 0;
          const pendingSessions = (sessionData as any)?.scheduledSessions || 0;

          responseMessage.content = `For ${dateRangeText}, there ${totalSessions === 1 ? 'is' : 'are'} ${totalSessions} ${totalSessions === 1 ? 'session' : 'sessions'} ${
            therapist_id ? 'for this therapist' :
            client_id ? 'for this client' :
            'scheduled'
          }.${
            completedSessions > 0 ? ` ${completedSessions} ${completedSessions === 1 ? 'session has' : 'sessions have'} been completed.` : ''
          }${
            pendingSessions > 0 ? ` ${pendingSessions} ${pendingSessions === 1 ? 'session is' : 'sessions are'} still pending.` : ''
          }` as any;
        } catch (error) {
          console.error('Error getting session counts:', error);
          (responseMessage as any).content = "I'm sorry, I couldn't retrieve the session counts. There might be an issue with the database connection.";
        }

        action = null as any;
      } else if (executionMode === "suggestion_only") {
        await trace({
          stepName: "tool.execution.suggestion_only",
          status: "ok",
          payload: {
            toolName: functionName,
            role: executionGate.role,
          },
        });
        action = null as any;
      } else {
        action = {
          type: functionName,
          data: functionArgs
        } as any;
        await trace({
          stepName: "tool.execution.allowed",
          status: "ok",
          payload: {
            toolName: functionName,
            role: executionGate.role,
            executionMode,
          },
        });
      }
    }

    const blockedNotice = actionBlockedReason
      ? buildActionBlockedMessage(actionBlockedReason)
      : null;
    const responseText = responseMessage.content || "I'll help you with that request.";
    const response = {
      response: blockedNotice ? `${responseText}\n\n${blockedNotice}` : responseText,
      action,
      cacheHit: false,
      responseTime,
      conversationId,
      tokenUsage: (completion as any).usage ? {
        prompt: (completion as any).usage.prompt_tokens,
        completion: (completion as any).usage.completion_tokens,
        total: (completion as any).usage.total_tokens
      } : undefined,
      suggestions: (suggestions as any).length > 0 ? suggestions : undefined
    } as any;

    if (responseMessage.content) {
      await cacheAIResponse(cacheKey, message, responseMessage.content, {
        tokenUsage: (response as any).tokenUsage,
        hasAction: !!action,
        suggestions: (suggestions as any).length
      } as any);
    }

    await saveChatMessage(
      'user',
      message,
      context,
      undefined,
      conversationId
    );

    await saveChatMessage(
      'assistant',
      responseMessage.content || "I'll help you with that.",
      { optimized: true, cacheHit: false, responseTime } as any,
      action,
      conversationId
    );

    return response;

  } catch (error: any) {
    console.error('optimized_ai_processing_failed');
    await trace({
      stepName: "processing.error",
      status: "error",
      payload: {
        errorCode: isInsufficientQuotaError(error)
          ? "insufficient_quota"
          : "upstream_unavailable",
      },
    });

    if (isInsufficientQuotaError(error)) {
      throw new AgentUpstreamUnavailableError();
    }

    return {
      response: "I apologize, but I'm experiencing technical difficulties. Please try again or use the manual interface.",
      conversationId: (context as any).conversationId as string,
      responseTime: performance.now() - startTime
    } as any;
  }
}

async function saveChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  context: Record<string, unknown> = {},
  action?: { type: string; data: Record<string, unknown> },
  conversationId?: string
): Promise<string> {
  try {
    const db = createRequestClient((globalThis as any).currentRequest);
    const user = await getUserOrThrow(db);

    return await persistChatMessage({
      db,
      userId: user.id,
      role,
      content,
      context,
      action,
      conversationId,
    });
  } catch (error) {
    console.error('Error saving chat message:', error);
    return conversationId || crypto.randomUUID();
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  const requestId = getRequestId(req);
  const correlationId = req.headers.get("x-correlation-id") ?? requestId;
  const responseHeaders = {
    ...corsHeadersForRequest(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "x-request-id": requestId,
    "x-correlation-id": correlationId,
  };

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: `Method ${req.method} not allowed`,
        status: 405,
        headers: responseHeaders,
      });
    }

    (globalThis as any).currentRequest = req;

    const rawPayload = await req.json();
    const payload = AgentRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Invalid agent request payload",
        status: 400,
        headers: responseHeaders,
      });
    }
    const { message, context, agentWork } = payload.data;

    const db = createRequestClient(req);
    const user = await getUserOrThrow(db);
    const orgId = await resolveOrgId(db);
    const logger = getLogger(req, {
      functionName: "ai-agent-optimized",
      userId: user.id,
      orgId,
    });

    const actorRole = await resolveActorRole(db, orgId);
    const requestedTools = Array.isArray(context?.guardrails?.allowedTools)
      ? context?.guardrails?.allowedTools
      : [];
    const gateBase = resolveExecutionGate(actorRole, requestedTools);
    const killSwitch = await resolveKillSwitch();
    const executionGate: ExecutionGate = {
      ...gateBase,
      ...killSwitch,
    };

    const traceContext: TraceContext = {
      requestId,
      correlationId: agentWork?.correlationId ?? correlationId,
      agentOperationId: req.headers.get("x-agent-operation-id"),
      conversationId: context?.conversationId,
      userId: user.id,
      orgId,
      workItemId: agentWork?.workItemId ?? null,
      stepId: agentWork?.stepId ?? null,
      attemptId: agentWork?.attemptId ?? null,
    };
    let traceIndex = 0;
    const trace = (step: TraceStep) =>
      insertAgentTrace(traceContext, step, traceIndex++);

    const promptToolResult = await resolvePromptToolVersion();
    const promptToolVersion = promptToolResult.version;
    if (!agentWork) {
      await trace({
        stepName: "prompt_tool.version.loaded",
        status: promptToolResult.error ? "error" : "ok",
        payload: {
          found: Boolean(promptToolVersion),
          promptVersion: promptToolVersion?.promptVersion ?? null,
          toolVersion: promptToolVersion?.toolVersion ?? null,
          status: promptToolVersion?.status ?? null,
          error: promptToolResult.error ?? null,
        },
      });
    }

    const sanitizedMessage = message ? sanitizeText(message, 4000) : undefined;
    const sanitizedContext = {
      ...(context as any),
      url: context?.url ? sanitizeText(context.url, 2048) : undefined,
      userAgent: context?.userAgent ? sanitizeText(context.userAgent, 512) : undefined,
    };

    logger.info("request.received", {
      metadata: {
        role: actorRole,
        hasConversation: Boolean(context?.conversationId),
        ledgerBound: Boolean(agentWork),
        promptVersion: promptToolVersion?.promptVersion ?? null,
        toolVersion: promptToolVersion?.toolVersion ?? null,
      },
    });
    if (!agentWork) {
      await trace({
        stepName: "request.received",
        status: "ok",
        payload: {
          role: actorRole,
          requestedTools,
          agentOperationId: traceContext.agentOperationId ?? null,
          guardrailResult: "request_validated",
          outcome: "generic_request",
        },
      });
    }

    if (agentWork) {
      if (!orgId || orgId !== agentWork.organizationId) {
        throw new AgentLedgerPolicyError("organization_scope_mismatch", 403);
      }
      if (!promptToolVersion) {
        throw new AgentLedgerPolicyError("prompt_tool_version_unavailable", 503);
      }
      const response = await processLedgerRemediation(
        agentWork,
        user.id,
        requestId,
        promptToolVersion,
        trace,
      );
      await trace({
        stepName: "response.sent",
        status: "ok",
        payload: {
          attemptId: agentWork.attemptId,
          guardrailResult: "human_review_required",
          outcome: "candidate_evidence",
        },
      });
      return new Response(JSON.stringify(response), { headers: responseHeaders });
    }

    if (executionGate.deniedTools.length > 0 || executionGate.killSwitchEnabled) {
      logger.warn("authorization.denied", {
        metadata: {
          deniedTools: executionGate.deniedTools,
          killSwitchEnabled: executionGate.killSwitchEnabled,
        },
      });
      await trace({
        stepName: "execution.gate.denied",
        status: "blocked",
        payload: {
          deniedTools: executionGate.deniedTools,
          killSwitchEnabled: executionGate.killSwitchEnabled,
          killSwitchReason: executionGate.killSwitchReason ?? null,
          killSwitchSource: executionGate.killSwitchSource ?? null,
        },
      });
    } else {
      await trace({
        stepName: "execution.gate.allowed",
        status: "ok",
        payload: {
          allowedTools: executionGate.allowedTools,
          role: actorRole,
        },
      });
    }

    const enrichedContext = {
      ...(sanitizedContext as any),
      promptToolVersion: promptToolVersion
        ? {
            promptVersion: promptToolVersion.promptVersion,
            toolVersion: promptToolVersion.toolVersion,
            status: promptToolVersion.status,
          }
        : null,
      userRoles: Array.isArray((context as any)?.userRoles)
        ? (context as any)?.userRoles
        : [actorRole],
      actor: { id: user.id, role: actorRole },
      guardrails: {
        ...(context as any)?.guardrails,
        allowedTools: executionGate.allowedTools,
      },
    };

    const response = await processOptimizedMessage(
      sanitizedMessage as string,
      enrichedContext,
      executionGate,
      trace,
      traceContext
    );
    traceContext.conversationId = response.conversationId ?? traceContext.conversationId;

    logger.info("request.completed", {
      metadata: {
        cacheHit: response.cacheHit ?? false,
        responseTime: response.responseTime ?? null,
        hasAction: Boolean(response.action),
      },
    });
    await trace({
      stepName: "response.sent",
      status: "ok",
      payload: {
        cacheHit: response.cacheHit ?? false,
        responseTime: response.responseTime ?? null,
        hasAction: Boolean(response.action),
      },
    });

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          ...responseHeaders,
        },
      }
    );
  } catch (error: any) {
    if (error instanceof AgentLedgerPolicyError) {
      return errorEnvelope({
        requestId,
        code: error.code,
        message: error.message,
        status: error.status,
        headers: responseHeaders,
      });
    }
    if (error instanceof AgentUpstreamUnavailableError) {
      return errorEnvelope({
        requestId,
        code: error.code,
        message: error.message,
        headers: responseHeaders,
      });
    }

    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return new Response(body, {
        status: error.status,
        headers: responseHeaders,
      });
    }

    console.error("ai_agent_handler_failed");
    return errorEnvelope({
      requestId,
      code: "internal_error",
      message: "Internal Server Error",
      status: 500,
      headers: responseHeaders,
    });
  }
});
