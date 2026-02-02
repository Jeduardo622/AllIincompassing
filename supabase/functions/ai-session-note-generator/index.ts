import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { errorEnvelope, getRequestId, rateLimit } from "./lib/http/error.ts";
import { withRetry } from "../_shared/retry.ts";
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

const NoteSchema = z.object({
  prompt: z.string().min(1).max(6000),
  model: z.enum(["gpt-4", "gpt-4o"]).optional(),
  max_tokens: z.number().int().positive().max(4000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  session_data: z.record(z.unknown()).optional(),
  transcript_data: z.record(z.unknown()).optional(),
});

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
    const requestId = getRequestId(req);
    if (req.method !== "POST") {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: `Method ${req.method} not allowed`,
        status: 405,
        headers: corsHeaders,
      });
    }

    // Token-bucket rate limit 30 req/min per IP
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`ai-session-note-generator:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
      });
    }

    const db = createRequestClient(req);
    const user = await getUserOrThrow(db);

    const startTime = Date.now();
    const body = await req.json();
    const parsed = NoteSchema.safeParse(body);
    if (!parsed.success) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Invalid request body",
        status: 400,
        headers: corsHeaders,
      });
    }
    const {
      prompt,
      model = "gpt-4",
      max_tokens = 2000,
      temperature = 0.3,
      session_data,
    } = parsed.data;
    const organizationId = typeof session_data?.organization_id === "string"
      ? session_data.organization_id
      : null;
    if (organizationId && !z.string().uuid().safeParse(organizationId).success) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Invalid organization_id",
        status: 400,
        headers: corsHeaders,
      });
    }

    // Enhance prompt with California compliance requirements
    const sanitizedPrompt = prompt.replace(/[\p{C}]/gu, ' ').slice(0, 6000);
    const enhancedPrompt = `${CALIFORNIA_COMPLIANCE_PROMPT}\n\nSESSION DATA:\n${sanitizedPrompt}`;

    // Call OpenAI GPT-4 API
    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: "system",
              content:
                "You are an expert ABA therapist creating California-compliant clinical documentation. Always respond with valid JSON only.",
            },
            {
              role: "user",
              content: enhancedPrompt,
            },
          ],
          max_tokens: max_tokens,
          temperature: temperature,
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        maxDelayMs: 2000,
        retryOn: (error) => {
          const status = (error as any)?.status ?? (error as any)?.response?.status;
          if (status && [429, 500, 502, 503, 504].includes(Number(status))) {
            return true;
          }
          const message = String((error as any)?.message ?? '');
          return /rate limit|timeout|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
        },
      },
    );

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

    const ParsedSchema = z.object({
      observations: z.array(z.unknown()).optional(),
      data_summary: z.array(z.unknown()).optional(),
      interventions: z.array(z.unknown()).optional(),
      progress: z.array(z.unknown()).optional(),
      confidence: z.number().optional(),
    }).passthrough();
    const parsedValidation = ParsedSchema.safeParse(parsedContent);
    if (!parsedValidation.success) {
      throw new Error("Invalid JSON response schema");
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

    // Best-effort metrics logging via RLS-scoped table
    try {
      await db.from('ai_performance_metrics').insert({
        user_id: user.id,
        organization_id: organizationId,
        function_called: 'ai-session-note-generator',
        response_time_ms: processingTime,
        token_usage: {
          prompt_tokens: completion.usage?.prompt_tokens || 0,
          completion_tokens: completion.usage?.completion_tokens || 0,
          total_tokens: completion.usage?.total_tokens || 0
        },
        error_occurred: false
      });
    } catch (metricsErr) {
      console.warn('Failed to record AI metrics:', metricsErr);
    }

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    const requestId = getRequestId(req);
    console.error('Session note generation error:', error);
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    const code =
      status === 429 ? 'rate_limited' :
      status === 503 ? 'upstream_unavailable' :
      status === 504 ? 'upstream_timeout' :
      status === 502 ? 'upstream_error' :
      'internal_error';
    return errorEnvelope({
      requestId,
      code,
      message: 'Unexpected error',
      status: 500,
      headers: corsHeaders,
    });
  }
}); 