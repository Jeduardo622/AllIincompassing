import { OpenAI } from "npm:openai@5.5.1";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

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
          date_range: { type: "string", description: "Date range to optimize" },
          constraints: { type: "object", description: "Constraints" }
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
    userRole: context.userRole || 'user',
    page: context.currentPage || 'unknown'
  });
  
  // Use database function for consistent key generation
  const { data } = await supabaseClient.rpc('generate_semantic_cache_key', {
    p_query_text: query,
    p_context_hash: contextHash
  });
  
  return data || `ai_${Date.now()}`;
}

async function checkCachedResponse(cacheKey: string): Promise<string | null> {
  try {
    const { data } = await supabaseClient.rpc('get_cached_ai_response', {
      p_cache_key: cacheKey
    });
    
    return data?.[0]?.response_text || null;
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
    await supabaseClient.rpc('cache_ai_response', {
      p_cache_key: cacheKey,
      p_query_text: query,
      p_response_text: response,
      p_metadata: metadata,
      p_expires_at: new Date(Date.now() + AI_CACHE_CONFIG.RESPONSE_PATTERNS.common_queries)
    });
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
        therapists: contextData.therapists?.length || 0,
        clients: contextData.clients?.length || 0,
        todaySessions: contextData.todaySessions?.length || 0,
        userRole: userRoles[0] || 'user'
      },
      recentActions: recentHistory.slice(0, 3), // Last 3 interactions only
      currentTime: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Context building failed:', error);
    return { summary: { userRole: 'user' }, recentActions: [] };
  }
}

async function getCompressedContextData(): Promise<ContextData> {
  // Use Phase 3 optimized queries for efficiency
  try {
    const { data } = await supabaseClient.rpc('get_dropdown_data');
    return data || {};
  } catch {
    // Fallback to basic counts
    const [therapists, clients, sessions] = await Promise.all([
      supabaseClient.from('therapists').select('id').eq('status', 'active'),
      supabaseClient.from('clients').select('id'),
      supabaseClient.from('sessions').select('id').gte('start_time', new Date().toISOString().split('T')[0])
    ]);
    
    return {
      therapists: therapists.data || [],
      clients: clients.data || [],
      todaySessions: sessions.data || []
    };
  }
}

async function getOptimizedChatHistory(conversationId?: string): Promise<ChatMessage[]> {
  if (!conversationId) return [];
  
  try {
    const { data } = await supabaseClient.rpc('get_recent_chat_history', {
      p_conversation_id: conversationId,
      p_limit: 5 // Reduced for token efficiency
    });
    
    return data || [];
  } catch (error) {
    console.warn('Chat history fetch failed:', error);
    return [];
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
    // Check for upcoming conflicts
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    
    const { data: conflicts } = await supabaseClient.rpc('detect_scheduling_conflicts', {
      p_start_date: tomorrow,
      p_end_date: nextWeek,
      p_include_suggestions: false
    });
    
    const suggestions: Suggestion[] = [];
    
    if (conflicts && conflicts.length > 0) {
      suggestions.push({
        type: 'conflict_warning',
        message: `${conflicts.length} potential scheduling conflicts detected in the next week`,
        confidence: 0.9,
        action: 'predict_conflicts'
      });
    }
    
    // Workload recommendations
    if (context.summary?.userRole === 'admin') {
      suggestions.push({
        type: 'workload_analysis',
        message: 'Run workload analysis to optimize therapist schedules',
        confidence: 0.7,
        action: 'analyze_workload'
      });
    }
    
    return suggestions;
  } catch (error) {
    console.warn('Suggestion generation failed:', error);
    return [];
  }
}

// ============================================================================
// OPTIMIZED AI PROCESSING
// ============================================================================

// Initialize OpenAI with optimized configuration
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

// Initialize Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? '',
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '',
);

async function processOptimizedMessage(
  message: string,
  context: Record<string, unknown>
): Promise<OptimizedAIResponse> {
  const startTime = performance.now();
  
  try {
    // Step 1: Check cache for similar queries
    const cacheKey = await generateSemanticCacheKey(message, context);
    const cachedResponse = await checkCachedResponse(cacheKey);
    
    if (cachedResponse) {
      return {
        response: cachedResponse,
        cacheHit: true,
        responseTime: performance.now() - startTime
      };
    }
    
    // Step 2: Build optimized context
    const optimizedContext = await buildOptimizedContext(context.userRoles as string[] || [], context.conversationId as string);
    
    // Step 3: Generate proactive suggestions
    const suggestions = await generateProactiveSuggestions(optimizedContext);
    
    // Step 4: Build compressed prompt
    const contextPrompt = `CONTEXT: ${JSON.stringify(optimizedContext.summary)}
RECENT: ${optimizedContext.recentActions.map(a => `${a.role}: ${a.content}`).join('; ')}
TIME: ${optimizedContext.currentTime}`;
    
    // Step 5: Get AI response with optimized configuration
    const completion = await openai.chat.completions.create({
      ...OPTIMIZED_AI_CONFIG,
      messages: [
        { role: 'system', content: OPTIMIZED_SYSTEM_PROMPT },
        { role: 'system', content: contextPrompt },
        { role: 'user', content: message }
      ],
      tools: compressedFunctionSchemas
    });
    
    const responseMessage = completion.choices[0].message;
    const responseTime = performance.now() - startTime;
    
    // Step 6: Process function calls
    let action;
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      // Process date references
      if (functionArgs.date === 'today') {
        functionArgs.date = new Date().toISOString().split('T')[0];
      } else if (functionArgs.date === 'tomorrow') {
        functionArgs.date = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      }
      
      action = {
        type: functionName,
        data: functionArgs
      };
    }
    
    const response: OptimizedAIResponse = {
      response: responseMessage.content || "I'll help you with that request.",
      action,
      cacheHit: false,
      responseTime,
      tokenUsage: completion.usage ? {
        prompt: completion.usage.prompt_tokens,
        completion: completion.usage.completion_tokens,
        total: completion.usage.total_tokens
      } : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
    
    // Step 7: Cache response for future use
    if (responseMessage.content) {
      await cacheAIResponse(cacheKey, message, responseMessage.content, {
        tokenUsage: response.tokenUsage,
        hasAction: !!action,
        suggestions: suggestions.length
      });
    }
    
    // Step 8: Save to chat history
    await saveChatMessage(
      'user',
      message,
      context,
      undefined,
      context.conversationId as string
    );
    
    await saveChatMessage(
      'assistant', 
      responseMessage.content || "I'll help you with that.",
      { optimized: true, cacheHit: false, responseTime },
      action,
      context.conversationId as string
    );
    
    return response;
    
  } catch (error) {
    console.error('Optimized AI processing failed:', error);
    
    return {
      response: "I apologize, but I'm experiencing technical difficulties. Please try again or use the manual interface.",
      responseTime: performance.now() - startTime
    };
  }
}

async function saveChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  context: Record<string, unknown> = {},
  action?: { type: string; data: Record<string, unknown> },
  conversationId?: string
): Promise<string | undefined> {
  try {
    const { data, error } = await supabaseClient
      .from('chat_history')
      .insert({
        role,
        content,
        context,
        action_type: action?.type,
        action_data: action?.data,
        conversation_id: conversationId || undefined
      })
      .select('conversation_id')
      .single();

    if (error) throw error;
    return data?.conversation_id;
  } catch (error) {
    console.error('Error saving chat message:', error);
    return undefined;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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

    const { message, context } = await req.json();
    
    // Process with optimized AI pipeline
    const response = await processOptimizedMessage(message, context || {});

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
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