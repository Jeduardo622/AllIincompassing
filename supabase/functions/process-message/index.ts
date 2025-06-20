import { OpenAI } from "npm:openai@5.5.1";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: Record<string, any>;
}

interface AIResponse {
  response: string;
  action?: {
    type: 'schedule_session' | 'cancel_sessions' | 'modify_session' | 'create_client' | 'create_therapist' | 'update_client' | 'update_therapist' | 'create_authorization' | 'update_authorization' | 'initiate_client_onboarding';
    data: Record<string, any>;
  };
  conversationId?: string;
}

const SYSTEM_PROMPT = `You are an AI assistant for a therapy practice management system. Your role is to help with:

1. Session Management
- Schedule new sessions
- Cancel existing sessions (for today, tomorrow, or specific dates)
- Modify session details
- Handle bulk operations on sessions

2. Client Management
- Create and update client profiles
- Track service hours and preferences
- Monitor scheduling preferences

3. Therapist Management
- Manage therapist schedules
- Track availability and specialties
- Handle service assignments

4. Authorization Management
- Create and update authorizations
- Track service units and dates
- Monitor authorization status

IMPORTANT INSTRUCTIONS:
1. Be decisive and take action immediately when requested
2. When canceling sessions:
   - Use today's date if "today" is mentioned
   - Use tomorrow's date if "tomorrow" is mentioned
   - Extract specific dates from context
   - Return a cancel_sessions action with the date
3. When scheduling or modifying sessions:
   - Gather all necessary details
   - Return appropriate action
4. When managing clients/therapists:
   - Collect all required information
   - Validate data before updates
5. When handling authorizations:
   - Ensure all required fields are present
   - Validate dates and units
6. Always confirm when actions are complete
7. Use ISO date format (YYYY-MM-DD) for all dates
8. Maintain conversation context:
   - Reference previous actions and their outcomes
   - Remember user preferences and patterns
   - Provide consistent responses across conversations
9. When you need specific details:
   - Use get_client_details to fetch client information
   - Use get_therapist_details to fetch therapist information
   - Use get_authorization_details to fetch authorization information
10. When a user wants to onboard a new client:
   - Collect basic information like name, email, date of birth
   - Ask about insurance information and service preferences
   - Use the initiate_client_onboarding function to start the process`;

// Initialize OpenAI with API key from environment variable
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

// Initialize Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? '',
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '',
);

async function getContextData() {
  // Get current user roles
  const { data: rolesData } = await supabaseClient.rpc('get_user_roles');
  const userRoles = rolesData?.[0]?.roles || [];

  // Get active therapists
  const { data: therapists } = await supabaseClient
    .from('therapists')
    .select('*')
    .eq('status', 'active');

  // Get active clients
  const { data: clients } = await supabaseClient
    .from('clients')
    .select('*');

  // Get upcoming sessions
  const { data: sessions } = await supabaseClient
    .from('sessions')
    .select(`
      *,
      therapist:therapists!inner(
        id,
        full_name,
        service_type
      ),
      client:clients!inner(
        id,
        full_name,
        service_preference
      )
    `)
    .gte('start_time', new Date().toISOString())
    .order('start_time');

  return {
    userRoles,
    therapists: therapists || [],
    clients: clients || [],
    sessions: sessions || []
  };
}

async function getRecentChatHistory(conversationId?: string): Promise<any[]> {
  const { data, error } = await supabaseClient.rpc(
    'get_recent_chat_history',
    { 
      p_conversation_id: conversationId,
      p_limit: 10
    }
  );

  if (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }

  return data || [];
}

async function saveChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  context: Record<string, any> = {},
  action?: {
    type: string;
    data: Record<string, any>;
  },
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

function formatContextMessage(
  context: {
    userRoles: string[];
    therapists: any[];
    clients: any[];
    sessions: any[];
  },
  chatHistory: any[]
): string {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  
  const historyContext = chatHistory.length > 0 
    ? '\nRecent conversation:\n' + chatHistory
        .reverse()
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n')
    : '';
  
  return `Current context:

Date: ${today}
Tomorrow: ${tomorrow}

User roles: ${context.userRoles.join(', ')}

Today's sessions: ${context.sessions
  .filter(s => s.start_time.startsWith(today))
  .map(s => 
    `\n- ${new Date(s.start_time).toLocaleTimeString()}: ${s.therapist.full_name} with ${s.client.full_name}`
  ).join('')}

Tomorrow's sessions: ${context.sessions
  .filter(s => s.start_time.startsWith(tomorrow))
  .map(s => 
    `\n- ${new Date(s.start_time).toLocaleTimeString()}: ${s.therapist.full_name} with ${s.client.full_name}`
  ).join('')}

Upcoming sessions: ${context.sessions
  .filter(s => !s.start_time.startsWith(today) && !s.start_time.startsWith(tomorrow))
  .slice(0, 5)
  .map(s => 
    `\n- ${new Date(s.start_time).toLocaleDateString()} ${new Date(s.start_time).toLocaleTimeString()}: ${s.therapist.full_name} with ${s.client.full_name}`
  ).join('')}

Available therapists: ${context.therapists.map(t => 
  `\n- ${t.full_name} (${t.service_type.join(', ')})`
).join('')}${historyContext}`;
}

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

    // Get current context data
    const contextData = await getContextData();
    
    // Get recent chat history
    const chatHistory = await getRecentChatHistory(context.conversationId);

    // Save user message
    const conversationId = await saveChatMessage(
      'user',
      message,
      { url: context.url, userAgent: context.userAgent },
      undefined,
      context.conversationId
    );

    // Prepare messages for the chat
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: formatContextMessage(contextData, chatHistory) },
      ...chatHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        context: msg.context
      })),
      { role: 'user', content: message }
    ];

    // Get response from OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 500,
      functions: [
        {
          name: "cancel_sessions",
          description: "Cancel one or more therapy sessions",
          parameters: {
            type: "object",
            properties: {
              date: {
                type: "string",
                format: "date",
                description: "The date for which to cancel sessions (YYYY-MM-DD)"
              },
              reason: {
                type: "string",
                description: "Reason for cancellation",
                default: "Staff development day"
              },
              therapist_id: {
                type: "string",
                description: "Optional: Specific therapist's sessions to cancel"
              }
            },
            required: ["date"]
          }
        },
        {
          name: "schedule_session",
          description: "Schedule a therapy session",
          parameters: {
            type: "object",
            properties: {
              therapist_id: { 
                type: "string",
                description: "The ID of the therapist"
              },
              client_id: { 
                type: "string",
                description: "The ID of the client"
              },
              start_time: { 
                type: "string", 
                format: "date-time",
                description: "Session start time (ISO 8601)"
              },
              end_time: { 
                type: "string", 
                format: "date-time",
                description: "Session end time (ISO 8601)"
              },
              location_type: {
                type: "string",
                enum: ["in_clinic", "in_home", "telehealth"],
                description: "Where the session will take place"
              }
            },
            required: ["therapist_id", "client_id", "start_time", "end_time", "location_type"]
          }
        },
        {
          name: "modify_session",
          description: "Modify an existing therapy session",
          parameters: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "The ID of the session to modify"
              },
              start_time: {
                type: "string",
                format: "date-time",
                description: "New session start time (ISO 8601)"
              },
              end_time: {
                type: "string",
                format: "date-time",
                description: "New session end time (ISO 8601)"
              },
              location_type: {
                type: "string",
                enum: ["in_clinic", "in_home", "telehealth"],
                description: "New session location"
              },
              status: {
                type: "string",
                enum: ["scheduled", "completed", "cancelled", "no-show"],
                description: "New session status"
              },
              notes: {
                type: "string",
                description: "Session notes"
              }
            },
            required: ["session_id"]
          }
        },
        {
          name: "create_client",
          description: "Create a new client profile",
          parameters: {
            type: "object",
            properties: {
              email: {
                type: "string",
                format: "email",
                description: "Client's email address"
              },
              first_name: { type: "string" },
              last_name: { type: "string" },
              date_of_birth: {
                type: "string",
                format: "date"
              },
              service_preference: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["in_clinic", "in_home", "telehealth"]
                }
              },
              authorized_hours: {
                type: "integer",
                description: "Monthly authorized service hours"
              }
            },
            required: ["email", "first_name", "last_name", "date_of_birth"]
          }
        },
        {
          name: "update_client",
          description: "Update an existing client profile",
          parameters: {
            type: "object",
            properties: {
              client_id: {
                type: "string",
                description: "The ID of the client to update"
              },
              email: { type: "string", format: "email" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              service_preference: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["in_clinic", "in_home", "telehealth"]
                }
              },
              authorized_hours: { type: "integer" }
            },
            required: ["client_id"]
          }
        },
        {
          name: "create_therapist",
          description: "Create a new therapist profile",
          parameters: {
            type: "object",
            properties: {
              email: {
                type: "string",
                format: "email",
                description: "Therapist's email address"
              },
              first_name: { type: "string" },
              last_name: { type: "string" },
              title: { type: "string" },
              specialties: {
                type: "array",
                items: { type: "string" }
              },
              service_type: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["in_clinic", "in_home", "telehealth"]
                }
              }
            },
            required: ["email", "first_name", "last_name"]
          }
        },
        {
          name: "update_therapist",
          description: "Update an existing therapist profile",
          parameters: {
            type: "object",
            properties: {
              therapist_id: {
                type: "string",
                description: "The ID of the therapist to update"
              },
              email: { type: "string", format: "email" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              title: { type: "string" },
              specialties: {
                type: "array",
                items: { type: "string" }
              },
              service_type: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["in_clinic", "in_home", "telehealth"]
                }
              }
            },
            required: ["therapist_id"]
          }
        },
        {
          name: "create_authorization",
          description: "Create a new service authorization",
          parameters: {
            type: "object",
            properties: {
              client_id: { type: "string" },
              provider_id: { type: "string" },
              authorization_number: { type: "string" },
              diagnosis_code: { type: "string" },
              diagnosis_description: { type: "string" },
              start_date: { type: "string", format: "date" },
              end_date: { type: "string", format: "date" },
              services: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    service_code: { type: "string" },
                    service_description: { type: "string" },
                    requested_units: { type: "integer" },
                    unit_type: { type: "string" }
                  },
                  required: ["service_code", "requested_units"]
                }
              }
            },
            required: ["client_id", "provider_id", "authorization_number", "start_date", "end_date"]
          }
        },
        {
          name: "update_authorization",
          description: "Update an existing service authorization",
          parameters: {
            type: "object",
            properties: {
              authorization_id: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "approved", "denied", "expired"]
              },
              services: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    service_id: { type: "string" },
                    approved_units: { type: "integer" },
                    decision_status: {
                      type: "string",
                      enum: ["pending", "approved", "denied"]
                    }
                  },
                  required: ["service_id"]
                }
              }
            },
            required: ["authorization_id"]
          }
        },
        {
          name: "get_client_details",
          description: "Get details for a specific client",
          parameters: {
            type: "object",
            properties: {
              clientId: { 
                type: "string", 
                description: "The ID of the client" 
              }
            },
            required: ["clientId"]
          }
        },
        {
          name: "get_therapist_details",
          description: "Get details for a specific therapist",
          parameters: {
            type: "object",
            properties: {
              therapistId: { 
                type: "string", 
                description: "The ID of the therapist" 
              }
            },
            required: ["therapistId"]
          }
        },
        {
          name: "get_authorization_details",
          description: "Get details for a specific authorization",
          parameters: {
            type: "object",
            properties: {
              authorizationId: { 
                type: "string", 
                description: "The ID of the authorization" 
              }
            },
            required: ["authorizationId"]
          }
        },
        {
          name: "initiate_client_onboarding",
          description: "Initiate the client onboarding process",
          parameters: {
            type: "object",
            properties: {
              client_name: { 
                type: "string", 
                description: "The name of the client" 
              },
              client_email: { 
                type: "string", 
                format: "email",
                description: "The email address of the client" 
              },
              date_of_birth: {
                type: "string",
                format: "date",
                description: "The client's date of birth (YYYY-MM-DD)"
              },
              insurance_provider: { 
                type: "string", 
                description: "The client's insurance provider" 
              },
              referral_source: { 
                type: "string", 
                description: "How the client was referred" 
              },
              service_preference: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["In clinic", "In home", "Telehealth"]
                },
                description: "The client's service delivery preferences"
              }
            },
            required: ["client_name", "client_email"]
          }
        }
      ]
    });

    const responseMessage = completion.choices[0].message;
    let action;

    // Handle function calls
    if (responseMessage.function_call) {
      const functionName = responseMessage.function_call.name;
      const functionArgs = JSON.parse(responseMessage.function_call.arguments);

      // Handle date references
      if (functionArgs.date === 'today') {
        functionArgs.date = new Date().toISOString().split('T')[0];
      } else if (functionArgs.date === 'tomorrow') {
        functionArgs.date = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      }

      // Add full_name for therapist creation/update
      if (functionName === 'create_therapist' || functionName === 'update_therapist') {
        if (functionArgs.first_name && functionArgs.last_name) {
          functionArgs.full_name = `${functionArgs.first_name} ${functionArgs.middle_name ? functionArgs.middle_name + ' ' : ''}${functionArgs.last_name}`.trim();
        }
      }

      // Add full_name for client creation/update
      if (functionName === 'create_client' || functionName === 'update_client') {
        if (functionArgs.first_name && functionArgs.last_name) {
          functionArgs.full_name = `${functionArgs.first_name} ${functionArgs.middle_name ? functionArgs.middle_name + ' ' : ''}${functionArgs.last_name}`.trim();
        }
      }

      // Handle client onboarding
      if (functionName === 'initiate_client_onboarding') {
        // Parse the client name into first and last name if possible
        if (functionArgs.client_name && !functionArgs.first_name && !functionArgs.last_name) {
          const nameParts = functionArgs.client_name.trim().split(/\s+/);
          if (nameParts.length >= 2) {
            functionArgs.first_name = nameParts[0];
            functionArgs.last_name = nameParts.slice(1).join(' ');
          } else {
            functionArgs.first_name = functionArgs.client_name;
            functionArgs.last_name = '';
          }
        }
      }

      action = {
        type: functionName as AIResponse['action']['type'],
        data: functionArgs
      };
    }

    // Save assistant response
    await saveChatMessage(
      'assistant',
      responseMessage.content || "I understand your request. Let me help you with that.",
      { completion },
      action,
      conversationId
    );

    const response: AIResponse = {
      response: responseMessage.content || "I understand your request. Let me help you with that.",
      action,
      conversationId
    };

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
    console.error('Error processing message:', error);
    
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