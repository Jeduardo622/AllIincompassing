import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
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
  assessment_document_id: z.string().uuid().optional(),
});

const MIN_CHILD_GOALS = 20;
const MIN_PARENT_GOALS = 6;
const MAX_GENERATION_ATTEMPTS = 3;
const OPENAI_ATTEMPT_TIMEOUT_MS = 20000;
const MAX_ASSESSMENT_PROMPT_CHARS = 9000;

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
        goal_type: z.enum(["child", "parent"]),
        target_behavior: z.string().trim().max(300).optional(),
        measurement_type: z.string().trim().max(80).optional(),
        baseline_data: z.string().trim().max(500).optional(),
        target_criteria: z.string().trim().max(500).optional(),
        mastery_criteria: z.string().trim().max(500).optional(),
        maintenance_criteria: z.string().trim().max(500).optional(),
        generalization_criteria: z.string().trim().max(500).optional(),
        objective_data_points: z.array(z.record(z.unknown())).max(12).optional(),
      }),
    )
    .min(MIN_CHILD_GOALS + MIN_PARENT_GOALS)
    .max(48),
  rationale: z.string().trim().max(2000).optional(),
});

const FALLBACK_WHITE_BIBLE_GUIDANCE = `
Applied Behavior Analysis practice guidance:
- Build goals from observable and measurable behavior, not traits.
- Use clear operational definitions and context for each target behavior.
- Include baseline and a measurable mastery criterion when possible.
- Keep interventions function-based, socially significant, and feasible for caregivers/therapists.
- Write goals so progress can be tracked across sessions with objective data.
`;

let cachedWhiteBibleGuidance: string | null = null;

const loadWhiteBibleGuidance = async (): Promise<string> => {
  if (cachedWhiteBibleGuidance) {
    return cachedWhiteBibleGuidance;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("ai_guidance_documents")
      .select("guidance_text")
      .eq("guidance_key", "white_bible_core")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && typeof data[0]?.guidance_text === "string") {
      const guidance = data[0].guidance_text.trim();
      if (guidance.length >= 30) {
        cachedWhiteBibleGuidance = guidance;
        return guidance;
      }
    }

    if (error) {
      console.warn("generate-program-goals: unable to load white-bible guidance from Supabase", error.message);
    }
  } catch (error) {
    console.warn("generate-program-goals: unexpected error loading white-bible guidance", error);
  }

  cachedWhiteBibleGuidance = FALLBACK_WHITE_BIBLE_GUIDANCE.trim();
  return cachedWhiteBibleGuidance;
};

const dedupeGoalsByTitle = (goals: z.infer<typeof responseSchema>["goals"]): z.infer<typeof responseSchema>["goals"] => {
  const seen = new Set<string>();
  return goals.filter((goal) => {
    const normalizedTitle = goal.title.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalizedTitle) {
      return false;
    }
    if (seen.has(normalizedTitle)) {
      return false;
    }
    seen.add(normalizedTitle);
    return true;
  });
};

const countGoalsByType = (goals: z.infer<typeof responseSchema>["goals"]) => {
  let childCount = 0;
  let parentCount = 0;
  goals.forEach((goal) => {
    if (goal.goal_type === "parent") {
      parentCount += 1;
      return;
    }
    childCount += 1;
  });
  return { childCount, parentCount };
};

const buildPrompt = (args: {
  whiteBibleGuidance: string;
  clientName?: string;
  assessmentText: string;
  retryHint?: string;
}): string => `
You are an ABA clinical planning assistant.
Use the assessment to draft one program and enough goals to support a full treatment plan.
Use this White Bible guidance as the highest-priority clinical style reference:
${args.whiteBibleGuidance}

Return JSON ONLY with this shape:
{
  "program": { "name": "string", "description": "string" },
  "goals": [
    {
      "title": "string",
      "description": "string",
      "original_text": "string",
      "goal_type": "child or parent",
      "target_behavior": "string",
      "measurement_type": "string",
      "baseline_data": "string",
      "target_criteria": "string",
      "mastery_criteria": "string",
      "maintenance_criteria": "string",
      "generalization_criteria": "string",
      "objective_data_points": [{ "objective": "string", "data_settings": "string" }]
    }
  ],
  "rationale": "short explanation"
}

Rules:
- Keep language clinical and objective.
- Do not include PHI beyond supplied client first name.
- Ensure each goal can be copied directly into an EHR.
- Goal titles must be unique.
- You MUST return at least ${MIN_CHILD_GOALS} goals with "goal_type":"child".
- You MUST return at least ${MIN_PARENT_GOALS} goals with "goal_type":"parent".
- Child goals should target learner skill acquisition, reduction, replacement, or adaptive behaviors.
- Parent goals should target caregiver implementation, parent training participation, and generalization support.
- If baseline/criteria are not explicit in the assessment, infer conservatively and state assumptions briefly.
- If document includes objective-level data settings (targets, phases, mastery/maintenance details), include them in objective_data_points.
${args.retryHint ? `- IMPORTANT RETRY FIX: ${args.retryHint}` : ""}

Client: ${args.clientName ?? "Not provided"}
Assessment:
${args.assessmentText}
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

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms) as unknown as number;
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
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

    const whiteBibleGuidance = await loadWhiteBibleGuidance();
    let retryHint: string | undefined;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const prompt = buildPrompt({
        whiteBibleGuidance,
        clientName: parsed.data.client_name,
        assessmentText: parsed.data.assessment_text.slice(0, MAX_ASSESSMENT_PROMPT_CHARS),
        retryHint,
      });
      const completion = await withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.2,
          max_tokens: 3000,
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
        }),
        OPENAI_ATTEMPT_TIMEOUT_MS,
      );

      if (!completion) {
        retryHint =
          `Previous attempt timed out after ${OPENAI_ATTEMPT_TIMEOUT_MS}ms. Return concise JSON only with required minimum counts.`;
        continue;
      }

      const rawContent = completion.choices[0]?.message?.content;
      if (!rawContent) {
        retryHint = "Previous attempt returned no content. Return full JSON object with program, goals, and rationale.";
        continue;
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(stripCodeFences(rawContent));
      } catch {
        retryHint = "Previous attempt returned invalid JSON. Return JSON only, no markdown or commentary.";
        continue;
      }

      const validated = responseSchema.safeParse(candidate);
      if (!validated.success) {
        retryHint =
          "Previous attempt failed schema validation. Every goal must include goal_type child or parent, and all required text fields.";
        continue;
      }

      const dedupedGoals = dedupeGoalsByTitle(validated.data.goals);
      if (dedupedGoals.length === 0) {
        retryHint = "Previous attempt had no valid unique goals. Use distinct titles for all goals.";
        continue;
      }
      const { childCount, parentCount } = countGoalsByType(dedupedGoals);
      if (childCount < MIN_CHILD_GOALS || parentCount < MIN_PARENT_GOALS) {
        retryHint =
          `Previous attempt only had ${childCount} child and ${parentCount} parent goals after dedupe. Regenerate full response with at least ${MIN_CHILD_GOALS} child and ${MIN_PARENT_GOALS} parent goals using unique titles.`;
        continue;
      }

      return json({ ...validated.data, goals: dedupedGoals }, 200);
    }

    return json(
      {
        error:
          `Generated draft did not meet goal minimums after ${MAX_GENERATION_ATTEMPTS} attempts: child>=${MIN_CHILD_GOALS}, parent>=${MIN_PARENT_GOALS}`,
      },
      502,
    );
  } catch (error) {
    console.error("generate-program-goals error", error);
    return json({ error: "Failed to generate draft" }, 500);
  }
});
