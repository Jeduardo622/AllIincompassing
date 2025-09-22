import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { OpenAI } from "npm:openai@5.5.1";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import {
  createPseudonym,
  hashIdentifier,
  PseudonymMap,
  redactAndPseudonymize,
  registerNamePseudonym,
  registerPseudonym
} from "../../../src/lib/phi/pseudonym.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

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
  timeZone?: string;
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
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    // Parse the request body
    const conflictDetails: ConflictDetails = await req.json();

    const therapistIdentifier =
      conflictDetails.therapist?.id ||
      conflictDetails.therapistId ||
      conflictDetails.therapist?.full_name ||
      'therapist';
    const clientIdentifier =
      conflictDetails.client?.id ||
      conflictDetails.clientId ||
      conflictDetails.client?.full_name ||
      'client';

    const therapistAlias = createPseudonym('Therapist', therapistIdentifier);
    const clientAlias = createPseudonym('Client', clientIdentifier);
    const therapistHash = hashIdentifier(therapistIdentifier);
    const clientHash = hashIdentifier(clientIdentifier);

    const pseudonymMap: PseudonymMap = {};
    registerNamePseudonym(pseudonymMap, conflictDetails.therapist?.full_name, therapistAlias);
    registerNamePseudonym(pseudonymMap, conflictDetails.client?.full_name, clientAlias);

    const therapistRecord = conflictDetails.therapist as Record<string, unknown>;
    const clientRecord = conflictDetails.client as Record<string, unknown>;

    if (typeof therapistRecord.email === "string") {
      registerPseudonym(pseudonymMap, therapistRecord.email, therapistAlias);
    }
    if (typeof clientRecord.email === "string") {
      registerPseudonym(pseudonymMap, clientRecord.email, clientAlias);
    }

    const zone = conflictDetails.timeZone ?? "UTC";
    const startDate = new Date(conflictDetails.startTime);
    const endDate = new Date(conflictDetails.endTime);

    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: zone,
    }).format(startDate).toLowerCase();
    const sessionDuration = (new Date(conflictDetails.endTime).getTime() - new Date(conflictDetails.startTime).getTime()) / (1000 * 60); // in minutes

    // Get the therapist's availability for the day
    const therapistAvailability = conflictDetails.therapist.availability_hours[dayOfWeek];

    // Get the client's availability for the day
    const clientAvailability = conflictDetails.client.availability_hours[dayOfWeek];

    // Get existing sessions for the therapist and client on the same day
    const existingSessionsOnSameDay = conflictDetails.existingSessions.filter(session => {
      const sessionDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(session.start_time));
      const requestedDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(startDate);
      return sessionDate === requestedDate;
    });

    const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: zone });
    const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });

    const requestedDateText = dateFormatter.format(startDate);
    const requestedStartText = timeFormatter.format(startDate);
    const requestedEndText = timeFormatter.format(endDate);

    const conflictMessages = conflictDetails.conflicts
      .map(conflict => `- ${conflict.message}`)
      .join("\n");

    const sanitizedConflictMessages = redactAndPseudonymize(
      conflictMessages.trim().length > 0 ? conflictMessages : "- None reported",
      pseudonymMap
    );

    const therapistAvailabilityWindow =
      therapistAvailability?.start && therapistAvailability?.end
        ? `${therapistAvailability.start} to ${therapistAvailability.end}`
        : "Not available";
    const clientAvailabilityWindow =
      clientAvailability?.start && clientAvailability?.end
        ? `${clientAvailability.start} to ${clientAvailability.end}`
        : "Not available";

    const sanitizedTherapistAvailability = redactAndPseudonymize(therapistAvailabilityWindow, pseudonymMap);
    const sanitizedClientAvailability = redactAndPseudonymize(clientAvailabilityWindow, pseudonymMap);

    const existingSessionsText = existingSessionsOnSameDay
      .map(session =>
        `- ${timeFormatter.format(new Date(session.start_time))} to ${timeFormatter.format(new Date(session.end_time))}: ${
          session.therapist_id === conflictDetails.therapistId ? "Therapist busy" : "Client busy"
        }`
      )
      .join("\n");

    const sanitizedExistingSessions = redactAndPseudonymize(
      existingSessionsText.trim().length > 0 ? existingSessionsText : "- None scheduled",
      pseudonymMap
    );

    const userPrompt = `I need to schedule a ${sessionDuration}-minute therapy session for ${therapistAlias} with ${clientAlias} on ${requestedDateText}.

I tried to schedule it from ${requestedStartText} to ${requestedEndText}, but encountered these conflicts:
${sanitizedConflictMessages}

Therapist availability on ${dayOfWeek}: ${sanitizedTherapistAvailability}
Client availability on ${dayOfWeek}: ${sanitizedClientAvailability}

Existing sessions on this day:
${sanitizedExistingSessions}

Please suggest 3-5 alternative time slots that would work for both the therapist and client.`;

    const sanitizedUserPrompt = redactAndPseudonymize(userPrompt, pseudonymMap);

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
          content: sanitizedUserPrompt
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
      tool_choice: { type: "function", function: { name: "suggest_alternative_times" } },
      metadata: {
        session_duration_minutes: sessionDuration,
        requested_start_iso: startDate.toISOString(),
        requested_end_iso: endDate.toISOString(),
        therapist_availability_start: therapistAvailability?.start ?? null,
        therapist_availability_end: therapistAvailability?.end ?? null,
        client_availability_start: clientAvailability?.start ?? null,
        client_availability_end: clientAvailability?.end ?? null,
        therapist_hash: therapistHash,
        client_hash: clientHash
      }
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
