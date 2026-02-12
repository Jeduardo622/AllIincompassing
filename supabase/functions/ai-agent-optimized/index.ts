import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { resolveOrgId } from "../_shared/org.ts";
import { getLogger } from "../_shared/logging.ts";
import { errorEnvelope, getRequestId, IsoDateSchema } from "../lib/http/error.ts";
import { persistChatMessage } from "./persistence.ts";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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
}

type AgentRole = "client" | "therapist" | "admin" | "super_admin";
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
};

type TraceStep = {
  stepName: string;
  status: "ok" | "blocked" | "error";
  payload?: Record<string, unknown>;
  replayPayload?: Record<string, unknown>;
};

const UuidSchema = z.string().uuid();
const AgentRequestSchema = z.object({
  message: z.string().min(1).max(4000),
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
});

const SESSION_TOOL_REGISTRY: Record<
  string,
  { roles: AgentRole[]; executionMode: ToolExecutionMode }
> = {
  schedule_session: {
    roles: ["therapist", "admin", "super_admin"],
    executionMode: "client_handoff",
  },
  cancel_sessions: {
    roles: ["therapist", "admin", "super_admin"],
    executionMode: "client_handoff",
  },
  start_session: {
    roles: ["therapist", "admin", "super_admin"],
    executionMode: "client_handoff",
  },
  predict_conflicts: {
    roles: ["therapist", "admin", "super_admin"],
    executionMode: "suggestion_only",
  },
  suggest_optimal_times: {
    roles: ["therapist", "admin", "super_admin"],
    executionMode: "suggestion_only",
  },
  get_monthly_session_count: {
    roles: ["therapist", "admin", "super_admin"],
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

const parseRoleList = (data: unknown): string[] => {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry) => {
    if (!entry) return [] as string[];
    const roleValue = (entry as { roles?: unknown }).roles;
    if (Array.isArray(roleValue)) {
      return roleValue.filter((role): role is string => typeof role === "string");
    }
    if (typeof roleValue === "string" && roleValue.length > 0) {
      try {
        const parsed = JSON.parse(roleValue) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((role): role is string => typeof role === "string");
        }
      } catch {
        // fall through to comma separated
      }
      return roleValue.split(",").map((role) => role.trim()).filter(Boolean);
    }
    return [] as string[];
  });
};

const resolveActorRole = async (db: ReturnType<typeof createRequestClient>): Promise<AgentRole> => {
  const { data, error } = await db.rpc("get_user_roles");
  if (error) {
    console.warn("Failed to resolve user roles for agent request", error);
    return "client";
  }
  const roles = parseRoleList(data);
  if (roles.includes("super_admin")) return "super_admin";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("therapist")) return "therapist";
  return "client";
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
    console.warn("Failed to load agent runtime config", error);
    return { killSwitchEnabled: false };
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
      return { version: null, error: error.message };
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
    return { version: null, error: String(error) };
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
      step_name: step.stepName,
      step_index: stepIndex,
      status: step.status,
      payload: step.payload ?? null,
      replay_payload: step.replayPayload ?? null,
    });
  } catch (error) {
    console.warn("Failed to insert agent trace", error);
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
    await getUserOrThrow(db);
    const { data } = await db.rpc('get_recent_chat_history', {
      p_conversation_id: conversationId,
      p_limit: 5
    } as any);

    return (data as any) || [];
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
          payload: { toolName: functionName, error: String(error) },
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
          replayPayload: {
            requestId: traceContext.requestId,
            correlationId: traceContext.correlationId,
            toolName: functionName,
            toolArguments: functionArgs,
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
          replayPayload: {
            requestId: traceContext.requestId,
            correlationId: traceContext.correlationId,
            toolName: functionName,
            toolArguments: functionArgs,
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
          replayPayload: {
            requestId: traceContext.requestId,
            correlationId: traceContext.correlationId,
            toolName: functionName,
            toolArguments: functionArgs,
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
    console.error('Optimized AI processing failed:', error);
    await trace({
      stepName: "processing.error",
      status: "error",
      payload: { error: error?.message ?? String(error) },
    });

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
    "Content-Type": "application/json",
    "x-request-id": requestId,
    "x-correlation-id": correlationId,
    ...corsHeaders,
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
    const { message, context } = payload.data;

    const db = createRequestClient(req);
    const user = await getUserOrThrow(db);
    const orgId = await resolveOrgId(db);
    const logger = getLogger(req, {
      functionName: "ai-agent-optimized",
      userId: user.id,
      orgId,
    });

    const actorRole = await resolveActorRole(db);
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
      correlationId,
      agentOperationId: req.headers.get("x-agent-operation-id"),
      conversationId: context?.conversationId,
      userId: user.id,
      orgId,
    };
    let traceIndex = 0;
    const trace = (step: TraceStep) =>
      insertAgentTrace(traceContext, step, traceIndex++);

    const promptToolResult = await resolvePromptToolVersion();
    const promptToolVersion = promptToolResult.version;
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

    const sanitizedMessage = sanitizeText(message, 4000);
    const sanitizedContext = {
      ...(context as any),
      url: context?.url ? sanitizeText(context.url, 2048) : undefined,
      userAgent: context?.userAgent ? sanitizeText(context.userAgent, 512) : undefined,
    };

    logger.info("request.received", {
      metadata: {
        role: actorRole,
        hasConversation: Boolean(context?.conversationId),
        promptVersion: promptToolVersion?.promptVersion ?? null,
        toolVersion: promptToolVersion?.toolVersion ?? null,
      },
    });
    await trace({
      stepName: "request.received",
      status: "ok",
      payload: {
        role: actorRole,
        requestedTools,
        url: context?.url,
        agentOperationId: traceContext.agentOperationId ?? null,
      },
      replayPayload: {
        message: sanitizedMessage,
        context: sanitizedContext,
        agentOperationId: traceContext.agentOperationId ?? null,
      },
    });

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
      sanitizedMessage,
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
    if (error instanceof Response) {
      const body = await error.text().catch(() => "");
      return new Response(body, {
        status: error.status,
        headers: responseHeaders,
      });
    }

    console.error("Handler error:", error);
    return errorEnvelope({
      requestId,
      code: "internal_error",
      message: error?.message ?? "Internal Server Error",
      status: 500,
      headers: responseHeaders,
    });
  }
});
