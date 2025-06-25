import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { OpenAI } from "npm:openai@5.5.1";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConflictDetails {
  startTime: string;
  endTime: string;
  therapistId: string;
  clientId: string;
  conflicts: Array<{
    type: 'therapist_unavailable' | 'client_unavailable' | 'session_overlap';
    message: string;
  }>;
  therapist: {
    id: string;
    full_name: string;
    availability_hours: Record<string, { start: string | null; end: string | null }>;
    service_type: string[];
  };
  client: {
    id: string;
    full_name: string;
    availability_hours: Record<string, { start: string | null; end: string | null }>;
    service_preference: string[];
  };
  existingSessions: Array<{
    id: string;
    therapist_id: string;
    client_id: string;
    start_time: string;
    end_time: string;
    status: string;
  }>;
}

interface AlternativeTime {
  startTime: string;
  endTime: string;
  score: number;
  reason: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get the JWT token from the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    // Verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Invalid token or user not found");
    }

    // Parse the request body
    const conflictDetails: ConflictDetails = await req.json();

    // Format the conflict details for the AI
    const dayOfWeek = new Date(conflictDetails.startTime).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const sessionDuration = (new Date(conflictDetails.endTime).getTime() - new Date(conflictDetails.startTime).getTime()) / (1000 * 60); // in minutes
    
    // Get the therapist's availability for the day
    const therapistAvailability = conflictDetails.therapist.availability_hours[dayOfWeek];
    
    // Get the client's availability for the day
    const clientAvailability = conflictDetails.client.availability_hours[dayOfWeek];
    
    // Get existing sessions for the therapist and client on the same day
    const existingSessionsOnSameDay = conflictDetails.existingSessions.filter(session => {
      const sessionDate = new Date(session.start_time).toDateString();
      const requestedDate = new Date(conflictDetails.startTime).toDateString();
      return sessionDate === requestedDate;
    });

    // Use OpenAI to suggest alternative times
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI assistant that helps resolve scheduling conflicts for therapy sessions. 
          Your task is to suggest alternative time slots that would work for both the therapist and client.
          Consider their availability, existing sessions, and try to minimize disruption.
          Provide 3-5 alternative time slots with a confidence score (0-1) and a brief reason for each suggestion.`
        },
        {
          role: "user",
          content: `I need to schedule a ${sessionDuration}-minute therapy session for therapist ${conflictDetails.therapist.full_name} 
          with client ${conflictDetails.client.full_name} on ${new Date(conflictDetails.startTime).toLocaleDateString()}.
          
          I tried to schedule it from ${new Date(conflictDetails.startTime).toLocaleTimeString()} to ${new Date(conflictDetails.endTime).toLocaleTimeString()},
          but encountered these conflicts:
          ${conflictDetails.conflicts.map(c => `- ${c.message}`).join('\n')}
          
          Therapist availability on ${dayOfWeek}: ${therapistAvailability.start ? `${therapistAvailability.start} to ${therapistAvailability.end}` : 'Not available'}
          Client availability on ${dayOfWeek}: ${clientAvailability.start ? `${clientAvailability.start} to ${clientAvailability.end}` : 'Not available'}
          
          Existing sessions on this day:
          ${existingSessionsOnSameDay.map(s => 
            `- ${new Date(s.start_time).toLocaleTimeString()} to ${new Date(s.end_time).toLocaleTimeString()}: ${
              s.therapist_id === conflictDetails.therapistId ? 'Therapist busy' : 'Client busy'
            }`
          ).join('\n')}
          
          Please suggest 3-5 alternative time slots that would work for both the therapist and client.`
        }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_alternative_times",
            description: "Suggest alternative time slots for the therapy session",
            parameters: {
              type: "object",
              properties: {
                alternatives: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      startTime: {
                        type: "string",
                        format: "date-time",
                        description: "The start time of the alternative slot in ISO format"
                      },
                      endTime: {
                        type: "string",
                        format: "date-time",
                        description: "The end time of the alternative slot in ISO format"
                      },
                      score: {
                        type: "number",
                        description: "Confidence score between 0 and 1, with 1 being the highest confidence"
                      },
                      reason: {
                        type: "string",
                        description: "Brief reason why this time slot is suggested"
                      }
                    },
                    required: ["startTime", "endTime", "score", "reason"]
                  }
                }
              },
              required: ["alternatives"]
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "suggest_alternative_times" } }
    });

    // Extract the function call result
    const toolCall = completion.choices[0].message.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error("No tool call result returned from OpenAI");
    }
    
    const alternativeTimes = JSON.parse(toolCall.function.arguments).alternatives;

    return new Response(
      JSON.stringify({ 
        alternatives: alternativeTimes,
        message: "Alternative times suggested successfully"
      }),
      {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  } catch (error) {
    console.error("Error suggesting alternative times:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "An error occurred while suggesting alternative times",
        message: "Failed to suggest alternative times"
      }),
      {
        status: 400,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  }
});