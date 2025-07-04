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

interface SessionNoteRequest {
  prompt: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  session_data?: Record<string, unknown>;
  transcript_data?: Record<string, unknown>;
}

interface SessionNoteResponse {
  content: string;
  confidence: number;
  compliance_score: number;
  california_compliant: boolean;
  insurance_ready: boolean;
  processing_time: number;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const CALIFORNIA_COMPLIANCE_PROMPT = `
You are an expert ABA (Applied Behavior Analysis) therapist creating clinical documentation that must comply with California state requirements and insurance standards.

CRITICAL REQUIREMENTS:
1. Use only objective, observable language (no subjective interpretations)
2. Include specific quantified data (frequencies, percentages, durations)
3. Use proper ABA terminology and evidence-based practices
4. Document antecedents, behaviors, and consequences (ABC format)
5. Include progress toward measurable goals
6. Ensure insurance billing compliance

RESPONSE FORMAT (JSON):
{
  "clinical_status": "Current clinical presentation and status",
  "goals": [
    {
      "goal_id": "string",
      "description": "string",
      "target_behavior": "string",
      "measurement_type": "frequency|duration|percentage|rate",
      "baseline_data": number,
      "target_criteria": number,
      "session_performance": number,
      "progress_status": "improving|maintaining|regressing|mastered"
    }
  ],
  "interventions": [
    {
      "type": "string",
      "aba_technique": "string",
      "description": "string",
      "implementation_fidelity": number,
      "client_response": "string",
      "effectiveness_rating": number
    }
  ],
  "observations": [
    {
      "behavior_type": "string",
      "description": "string",
      "frequency": number,
      "duration": number,
      "intensity": "low|medium|high",
      "antecedent": "string",
      "consequence": "string",
      "function_hypothesis": "string"
    }
  ],
  "responses": [
    {
      "stimulus": "string",
      "response": "string",
      "accuracy": number,
      "independence_level": "independent|verbal_prompt|gestural_prompt|physical_prompt|full_assistance",
      "latency": number
    }
  ],
  "data_summary": [
    {
      "program_name": "string",
      "trials_presented": number,
      "correct_responses": number,
      "incorrect_responses": number,
      "no_responses": number,
      "percentage_correct": number,
      "trend": "increasing|stable|decreasing"
    }
  ],
  "progress": [
    {
      "goal_id": "string",
      "current_performance": number,
      "previous_performance": number,
      "change_percentage": number,
      "clinical_significance": boolean,
      "next_steps": "string"
    }
  ],
  "recommendations": ["string"],
  "summary": "Comprehensive session summary",
  "confidence": number
}
`;

function validateCaliforniaCompliance(content: Record<string, unknown>): { compliant: boolean; insurance_ready: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  // Check for objective language
  if (!content.observations || content.observations.length === 0) {
    issues.push("Missing behavioral observations");
    score -= 20;
  }

  // Check for quantified data
  if (!content.data_summary || content.data_summary.length === 0) {
    issues.push("Missing quantified data collection");
    score -= 20;
  }

  // Check for ABA terminology
  if (!content.interventions || content.interventions.length === 0) {
    issues.push("Missing ABA intervention documentation");
    score -= 15;
  }

  // Check for progress documentation
  if (!content.progress || content.progress.length === 0) {
    issues.push("Missing progress toward goals");
    score -= 15;
  }

  // Check for ABC format in observations
  const hasABC = Array.isArray(content.observations) && content.observations.some((obs: Record<string, unknown>) => 
    obs.antecedent && obs.consequence
  );
  if (!hasABC) {
    issues.push("Missing ABC (Antecedent-Behavior-Consequence) format");
    score -= 10;
  }

  const compliant = score >= 80;
  const insurance_ready = score >= 90;

  return { compliant, insurance_ready, score, issues };
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

    const startTime = Date.now();
    const { 
      prompt, 
      model = "gpt-4", 
      max_tokens = 2000, 
      temperature = 0.3
    }: SessionNoteRequest = await req.json();

    if (!prompt) {
      throw new Error("Prompt is required");
    }

    // Enhance prompt with California compliance requirements
    const enhancedPrompt = `${CALIFORNIA_COMPLIANCE_PROMPT}\n\nSESSION DATA:\n${prompt}`;

    // Call OpenAI GPT-4 API
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "You are an expert ABA therapist creating California-compliant clinical documentation. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: enhancedPrompt
        }
      ],
      max_tokens: max_tokens,
      temperature: temperature
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error("No response generated");
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${parseError.message}`);
    }

    // Validate California compliance
    const complianceCheck = validateCaliforniaCompliance(parsedContent);
    
    const processingTime = Date.now() - startTime;

    const response: SessionNoteResponse = {
      content: responseText,
      confidence: parsedContent.confidence || 0.85,
      compliance_score: complianceCheck.score,
      california_compliant: complianceCheck.compliant,
      insurance_ready: complianceCheck.insurance_ready,
      processing_time: processingTime,
      token_usage: {
        prompt_tokens: completion.usage?.prompt_tokens || 0,
        completion_tokens: completion.usage?.completion_tokens || 0,
        total_tokens: completion.usage?.total_tokens || 0
      }
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
    console.error('Session note generation error:', error);
    
    return new Response(
      JSON.stringify({
        error: "Session note generation failed",
        message: error.message,
        processing_time: Date.now()
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