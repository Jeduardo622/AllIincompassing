import { OpenAI } from "npm:openai@5.5.1";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";

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
const OPTIMIZED_SYSTEM_PROMPT = `You are an AI assistant for therapy practice management. Key capabilities:

ACTIONS: Schedule/cancel/modify sessions, manage clients/therapists, handle authorizations
INTELLIGENCE: Detect conflicts, suggest optimal times, analyze workloads, batch operations
EFFICIENCY: Use bulk operations when possible, provide proactive suggestions, auto-resolve conflicts

BEHAVIOR:
- Be decisive and take immediate action
- Use compressed, professional responses
- Leverage bulk operations for efficiency
- Provide conflict resolution suggestions
- Offer proactive optimization recommendations

DATETIME: Use ISO format (YYYY-MM-DD). "Today"=${new Date().toISOString().split('T')[0]}, "tomorrow"=${new Date(Date.now() + 86400000).toISOString().split('T')[0]}`;

// ============================================================================
// COMPRESSED FUNCTION SCHEMAS (Token Optimized)
// ============================================================================

const compressedFunctionSchemas = [
  {
    type: "function",
    function: {
      name: "bulk_schedule",
      description: "Schedule multiple sessions with conflict resolution",
      parameters: {
        type: "object",
        properties: {
          sessions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                therapist: { type: "string", description: "Name or ID" },
                client: { type: "string", description: "Name or ID" },
                datetime: { type: "string", description: "ISO or natural language" },
                duration: { type: "integer", default: 60 },
                location: { type: "string", enum: ["clinic", "home", "telehealth"], default: "clinic" }
              },
              required: ["therapist", "client", "datetime"]
            }
          },
          auto_resolve: { type: "boolean", default: true }
        },
        required: ["sessions"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_session",
      description: "Schedule single therapy session",
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
      name: "smart_schedule_optimization",
      description: "AI-driven schedule optimization",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["conflict_resolution", "load_balancing", "efficiency"] },
          date_range: { type: "string", description: "Date range to optimize" },          constraints: { type: "object", description: "Constraints" }
        },
        required: ["type"]
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
      name: "analyze_workload",
      description: "Therapist workload analysis with recommendations",
      parameters: {
        type: "object",
        properties: {
          therapist_id: { type: "string", description: "Optional, all if not provided" },
          period_days: { type: "integer", default: 30 }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "quick_actions",
      description: "Common quick actions (create client/therapist, etc)",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create_client", "create_therapist", "update_client", "update_therapist"] },
          data: { type: "object", description: "Entity data" }
        },
        required: ["action", "data"]
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

  // Use per-request client for DB calls
  const db = createRequestClient((globalThis as any).currentRequest);
  await getUserOrThrow(db);
  const { data } = await db.rpc('generate_semantic_cache_key', {
    p_query_text: query,
    p_context_hash: contextHash
  } as any);

  return (data as any) || `ai_${Date.now()}`;
}

async function checkCachedResponse(cacheKey: string): Promise<string | null> {
  try {
    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);
    const { data } = await db.rpc('get_cached_ai_response', {
      p_cache_key: cacheKey
    } as any);

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
    const db = createRequestClient((globalThis as any).currentRequest);
    await getUserOrThrow(db);
    await db.rpc('cache_ai_response', {
      p_cache_key: cacheKey,
      p_query_text: query,
      p_response_text: response,
      p_metadata: metadata,
      p_expires_at: new Date(Date.now() + AI_CACHE_CONFIG.RESPONSE_PATTERNS.common_queries)
    } as any);
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
      db.from('therapists').select('id').eq('status', 'active'),
      db.from('clients').select('id'),
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

    if (context.summary?.userRole === 'admin') {
      suggestions.push({
        type: 'workload_analysis',
        message: 'Run workload analysis to optimize therapist schedules',
        confidence: 0.7,
        action: 'analyze_workload'
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
  context: Record<string, unknown>
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
    const cachedResponse = await checkCachedResponse(cacheKey);

    if (cachedResponse) {
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

    const completion = await openai.chat.completions.create({
      ...OPTIMIZED_AI_CONFIG as any,
      messages: [
        { role: 'system', content: OPTIMIZED_SYSTEM_PROMPT },
        { role: 'system', content: contextPrompt },
        { role: 'user', content: message }
      ],
      tools: compressedFunctionSchemas as any
    } as any);

    const responseMessage = completion.choices[0].message as any;
    const responseTime = performance.now() - startTime;

    const conversationId = (context as any).conversationId as string ||
                          (await saveChatMessage('user', message, context)).toString();

    let action: any;
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      if (functionArgs.date === 'today') {
        functionArgs.date = new Date().toISOString().split('T')[0];
      } else if (functionArgs.date === 'tomorrow') {
        functionArgs.date = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      }

      if (functionName === "get_monthly_session_count") {
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
      } else {
        action = {
          type: functionName,
          data: functionArgs
        } as any;
      }
    }

    const response = {
      response: responseMessage.content || "I'll help you with that request.",
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
    await getUserOrThrow(db);

    let actualConversationId = conversationId;
    if (!actualConversationId) {
      const { data: convData, error: convError } = await db
        .from('conversations')
        .insert({ user_id: null, title: "New Conversation" })
        .select('id')
        .single();

      if (convError) throw convError;
      actualConversationId = (convData as any).id;
    }

    const { data: msgData, error: msgError } = await db
      .from('chat_history')
      .insert({
        role,
        content,
        context,
        action_type: action?.type,
        action_data: action?.data,
        conversation_id: actualConversationId
      })
      .select('conversation_id')
      .single();

    if (msgError) throw msgError;
    return (msgData as any).conversation_id;
  } catch (error) {
    console.error('Error saving chat message:', error);
    return conversationId || crypto.randomUUID();
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      throw new Error(`Method ${req.method} not allowed`);
    }

    (globalThis as any).currentRequest = req;

    const { message, context } = await req.json();

    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const response = await processOptimizedMessage(message, (context as any) || {});

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('Handler error:', error);

    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});
