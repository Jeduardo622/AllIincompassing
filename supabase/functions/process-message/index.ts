import { OpenAI } from "npm:openai@5.5.1";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface BasicAIResponse {
  response: string;
  action?: {
    type: string;
    data: Record<string, unknown>;
  };
  conversationId?: string;
  responseTime?: number;
  fallback: true; // Indicate this is a fallback response
}

// Simple system prompt for fallback functionality
const BASIC_SYSTEM_PROMPT = `You are a helpful AI assistant for a therapy practice management system. 
You help with scheduling, client management, billing, and general practice operations.

Keep your responses clear, professional, and relevant to therapy practice management.
If you need to perform an action, respond with actionable suggestions.

Available contexts:
- Scheduling appointments and managing calendars
- Client information and notes
- Billing and insurance management
- Therapist assignments and availability
- General practice administration

Always be helpful while maintaining professional boundaries appropriate for healthcare administration.`;

// Basic AI configuration for fallback
const BASIC_AI_CONFIG = {
  model: "gpt-3.5-turbo", // Use faster, cheaper model for fallback
  temperature: 0.7,
  max_tokens: 1000,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
};

async function processBasicMessage(
  message: string,
  context: Record<string, unknown>
): Promise<BasicAIResponse> {
  const startTime = performance.now();
  
  try {
    console.log("Processing fallback message:", {
      message_length: message.length,
      context_keys: Object.keys(context || {})
    });

    // Build basic context string
    let contextPrompt = "";
    if (context && Object.keys(context).length > 0) {
      contextPrompt = `User Context: ${JSON.stringify(context, null, 2)}`;
    }

    // Create messages array
    const messages = [
      { role: 'system', content: BASIC_SYSTEM_PROMPT },
    ];

    if (contextPrompt) {
      messages.push({ role: 'system', content: contextPrompt });
    }

    messages.push({ role: 'user', content: message });

    // Get AI response with basic configuration
    const completion = await openai.chat.completions.create({
      ...BASIC_AI_CONFIG,
      messages: messages as any,
    });

    const responseMessage = completion.choices[0].message;
    const responseTime = performance.now() - startTime;

    console.log("Fallback response generated:", {
      response_length: responseMessage.content?.length || 0,
      response_time_ms: responseTime
    });

    return {
      response: responseMessage.content || "I apologize, but I couldn't generate a response. Please try again.",
      conversationId: context.conversationId as string,
      responseTime,
      fallback: true
    };

  } catch (error) {
    console.error("Error in processBasicMessage:", error);
    
    const responseTime = performance.now() - startTime;
    
    return {
      response: "I'm experiencing technical difficulties. Please try again in a moment or contact support if the issue persists.",
      conversationId: context.conversationId as string,
      responseTime,
      fallback: true
    };
  }
}

// Main handler
Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("Process-message fallback function called");
    
    const { message, context } = await req.json();
    
    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Message is required and must be a string"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Process with basic AI
    const response = await processBasicMessage(message, context || {});

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
        message: error.message,
        fallback: true
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