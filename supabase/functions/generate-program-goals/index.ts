import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { requireOrg } from "../_shared/org.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-request-id, x-correlation-id",
};

const requestSchema = z.object({
  assessment_text: z.string().trim().min(20).max(12000),
  client_name: z.string().trim().min(1).max(120).optional(),
});

const responseSchema = z.object({
  program: z.object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(1500).optional(),
  }),
  goals: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(160),
        description: z.string().trim().min(10).max(1500),
        original_text: z.string().trim().min(10).max(2000),
        target_behavior: z.string().trim().max(300).optional(),
        measurement_type: z.string().trim().max(80).optional(),
        baseline_data: z.string().trim().max(500).optional(),
        target_criteria: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(8),
  rationale: z.string().trim().max(2000).optional(),
});

const WHITE_BIBLE_GUIDANCE = `
Applied Behavior Analysis practice guidance:
- Build goals from observable and measurable behavior, not traits.
- Use clear operational definitions and context for each target behavior.
- Include baseline and a measurable mastery criterion when possible.
- Keep interventions function-based, socially significant, and feasible for caregivers/therapists.
- Write goals so progress can be tracked across sessions with objective data.
`;

const stripCodeFences = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, "")
    .replace(/```$/u, "")
    .trim();
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);
    await requireOrg(db);

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const prompt = `
You are an ABA clinical planning assistant.
Use the assessment to draft one program and 3-6 goals.
${WHITE_BIBLE_GUIDANCE}

Return JSON ONLY with this shape:
{
  "program": { "name": "string", "description": "string" },
  "goals": [
    {
      "title": "string",
      "description": "string",
      "original_text": "string",
      "target_behavior": "string",
      "measurement_type": "string",
      "baseline_data": "string",
      "target_criteria": "string"
    }
  ],
  "rationale": "short explanation"
}

Rules:
- Keep language clinical and objective.
- Do not include PHI beyond supplied client first name.
- Ensure each goal can be copied directly into an EHR.
- If baseline/criteria are not explicit in the assessment, infer conservatively and state assumptions briefly.

Client: ${parsed.data.client_name ?? "Not provided"}
Assessment:
${parsed.data.assessment_text}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content: "You produce strict JSON for ABA program and goal drafting.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      return json({ error: "No draft generated" }, 502);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(stripCodeFences(rawContent));
    } catch {
      return json({ error: "Model returned invalid JSON" }, 502);
    }

    const validated = responseSchema.safeParse(candidate);
    if (!validated.success) {
      return json({ error: "Generated draft did not pass schema validation" }, 502);
    }

    return json(validated.data, 200);
  } catch (error) {
    console.error("generate-program-goals error", error);
    return json({ error: "Failed to generate draft" }, 500);
  }
});
