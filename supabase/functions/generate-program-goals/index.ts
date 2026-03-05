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
const MIN_PARENT_GOALS_PER_SUBTYPE = 2;
const PARENT_GOAL_SUBTYPES = ["fidelity", "bst_participation", "generalization_support"] as const;
type ParentGoalSubtype = (typeof PARENT_GOAL_SUBTYPES)[number];
const MAX_GENERATION_ATTEMPTS = 2;
const OPENAI_ATTEMPT_TIMEOUT_MS = 12000;
const MAX_ASSESSMENT_PROMPT_CHARS = 6500;

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
  return goals.filter((goal: z.infer<typeof responseSchema>["goals"][number]) => {
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
  goals.forEach((goal: z.infer<typeof responseSchema>["goals"][number]) => {
    if (goal.goal_type === "parent") {
      parentCount += 1;
      return;
    }
    childCount += 1;
  });
  return { childCount, parentCount };
};

const truncate = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max - 1).trimEnd() + "…";
};

const buildSupplementalGoal = (args: {
  goalType: "child" | "parent";
  index: number;
  clientName?: string;
  assessmentText: string;
  parentSubtype?: ParentGoalSubtype;
}): z.infer<typeof responseSchema>["goals"][number] => {
  const learnerName = args.clientName?.trim() || "the learner";
  const assessmentSnippet = truncate(args.assessmentText.replace(/\s+/g, " ").trim(), 220);
  const sequence = args.index + 1;

  if (args.goalType === "parent") {
    if (args.parentSubtype === "bst_participation") {
      return {
        title: `Parent BST Participation Goal ${sequence}`,
        description:
          `${learnerName}'s caregiver will engage in behavior skills training (instruction, modeling, rehearsal, feedback) and ` +
          "demonstrate skill transfer to daily routines with measurable performance.",
        original_text:
          `Based on assessment context (${assessmentSnippet}), caregiver will complete structured BST sessions and apply trained ` +
          "procedures during home routines with documented outcomes.",
        goal_type: "parent",
        target_behavior: "Caregiver participation in BST and coached rehearsal performance",
        measurement_type: "Percent of BST components completed and independent rehearsal performance",
        baseline_data: "Caregiver participation and independent use of trained strategies are limited and require active coaching.",
        target_criteria: "Caregiver completes all BST components and reaches at least 80% correct rehearsal performance across two sessions.",
        mastery_criteria: ">=85% independent rehearsal performance across three sessions with reduced prompts.",
        maintenance_criteria: ">=80% performance during maintenance probes at 2 and 4 weeks.",
        generalization_criteria: "Caregiver applies trained skills across at least two routines and with two target behaviors.",
        objective_data_points: [
          {
            objective: "Participate in BST sequence and demonstrate coached rehearsal with performance feedback.",
            data_settings: "BST checklist + rehearsal fidelity scoring each session.",
          },
        ],
      };
    }

    if (args.parentSubtype === "generalization_support") {
      return {
        title: `Parent Generalization Support Goal ${sequence}`,
        description:
          `${learnerName}'s caregiver will plan and implement generalization opportunities across home/community contexts while ` +
          "collecting simple performance data for clinical review.",
        original_text:
          `Given assessment findings (${assessmentSnippet}), caregiver will implement and document generalization opportunities ` +
          "for target skills across settings, people, and routines.",
        goal_type: "parent",
        target_behavior: "Caregiver-led generalization planning, implementation, and tracking",
        measurement_type: "Frequency and quality of completed generalization opportunities",
        baseline_data: "Generalization opportunities are currently inconsistent and not systematically documented.",
        target_criteria: "Caregiver implements and records at least 4 planned generalization opportunities per week for two weeks.",
        mastery_criteria: "Caregiver sustains weekly generalization plan completion with >=85% task completion over three review periods.",
        maintenance_criteria: ">=80% plan adherence across monthly maintenance reviews.",
        generalization_criteria: "Demonstrated across home, community, and caregiver-led routines with at least two communication partners.",
        objective_data_points: [
          {
            objective: "Carry out scheduled generalization opportunities and record learner response/outcome.",
            data_settings: "Weekly caregiver log reviewed in supervision.",
          },
        ],
      };
    }

    return {
      title: `Parent Implementation Fidelity Goal ${sequence}`,
      description:
        `${learnerName}'s caregiver will implement the treatment-plan procedure with fidelity during coached practice and home routines, ` +
        "with measurable data collection and clinician feedback.",
      original_text:
        `Based on assessment context (${assessmentSnippet}), caregiver will demonstrate treatment implementation, prompting, and reinforcement ` +
        "steps with documented performance criteria.",
      goal_type: "parent",
      target_behavior: "Caregiver procedural fidelity and generalization support",
      measurement_type: "Percent of correctly implemented steps across opportunities",
      baseline_data: "Current caregiver implementation is inconsistent across routines and requires frequent clinician prompting.",
      target_criteria: "Caregiver implements at least 80% of required steps across two consecutive sessions.",
      mastery_criteria: ">=85% fidelity across three consecutive sessions with reduced coaching.",
      maintenance_criteria: ">=80% fidelity during maintenance probes at 2 and 4 weeks.",
      generalization_criteria: "Demonstrated across at least two home/community routines and one novel activity.",
      objective_data_points: [
        {
          objective: "Implement behavior protocol steps in order with correct prompting and reinforcement.",
          data_settings: "Fidelity checklist scored per opportunity with BCBA review.",
        },
      ],
    };
  }

  return {
    title: `Child Skill Acquisition Goal ${sequence}`,
    description:
      `${learnerName} will increase adaptive communication and functional responding in structured and natural environments using measurable targets.`,
    original_text:
      `Derived from assessment findings (${assessmentSnippet}), the learner will demonstrate improved functional communication and replacement ` +
      "behavior with observable response definitions.",
    goal_type: "child",
    target_behavior: "Functional communication and adaptive replacement responses",
    measurement_type: "Percent correct and frequency across opportunities",
    baseline_data: "Current performance is below expected level and requires moderate-to-high support.",
    target_criteria: "At least 80% correct responding across two consecutive sessions.",
    mastery_criteria: ">=85% independent responding across three sessions and two therapists.",
    maintenance_criteria: ">=80% responding during maintenance probes at 2 and 4 weeks.",
    generalization_criteria: "Demonstrated across clinic and home contexts with at least two communication partners.",
    objective_data_points: [
      {
        objective: "Demonstrate target response to natural and contrived cues with fading prompts.",
        data_settings: "Opportunity-based recording with prompt level and independence notes.",
      },
    ],
  };
};

const classifyParentGoalSubtype = (goal: z.infer<typeof responseSchema>["goals"][number]): ParentGoalSubtype => {
  const text = `${goal.title} ${goal.description} ${goal.target_behavior ?? ""} ${
    goal.objective_data_points ? JSON.stringify(goal.objective_data_points) : ""
  }`
    .toLowerCase()
    .trim();

  if (
    text.includes("bst") ||
    text.includes("behavior skills training") ||
    text.includes("instruction") ||
    text.includes("modeling") ||
    text.includes("rehearsal") ||
    text.includes("feedback")
  ) {
    return "bst_participation";
  }
  if (
    text.includes("generalization") ||
    text.includes("community") ||
    text.includes("home routine") ||
    text.includes("across settings") ||
    text.includes("across people")
  ) {
    return "generalization_support";
  }
  return "fidelity";
};

const ensureMinimumGoalMix = (args: {
  goals: z.infer<typeof responseSchema>["goals"];
  clientName?: string;
  assessmentText: string;
}): z.infer<typeof responseSchema>["goals"] => {
  const normalized = [...args.goals];
  const usedTitles = new Set(normalized.map((goal) => goal.title.trim().toLowerCase()));
  let { childCount, parentCount } = countGoalsByType(normalized);
  const parentSubtypeCounts: Record<ParentGoalSubtype, number> = {
    fidelity: 0,
    bst_participation: 0,
    generalization_support: 0,
  };

  normalized.forEach((goal) => {
    if (goal.goal_type !== "parent") {
      return;
    }
    const subtype = classifyParentGoalSubtype(goal);
    parentSubtypeCounts[subtype] += 1;
  });

  const appendUniqueGoal = (goalType: "child" | "parent", parentSubtype?: ParentGoalSubtype) => {
    let seed = goalType === "child" ? childCount : parentCount;
    let candidate = buildSupplementalGoal({
      goalType,
      index: seed,
      clientName: args.clientName,
      assessmentText: args.assessmentText,
      parentSubtype,
    });
    while (usedTitles.has(candidate.title.trim().toLowerCase())) {
      seed += 1;
      candidate = buildSupplementalGoal({
        goalType,
        index: seed,
        clientName: args.clientName,
        assessmentText: args.assessmentText,
        parentSubtype,
      });
    }
    usedTitles.add(candidate.title.trim().toLowerCase());
    normalized.push(candidate);
    if (goalType === "child") {
      childCount += 1;
    } else {
      parentCount += 1;
      const subtype = parentSubtype ?? classifyParentGoalSubtype(candidate);
      parentSubtypeCounts[subtype] += 1;
    }
  };

  for (const subtype of PARENT_GOAL_SUBTYPES) {
    while (parentSubtypeCounts[subtype] < MIN_PARENT_GOALS_PER_SUBTYPE && normalized.length < 48) {
      appendUniqueGoal("parent", subtype);
    }
  }

  while (childCount < MIN_CHILD_GOALS && normalized.length < 48) {
    appendUniqueGoal("child");
  }
  while (parentCount < MIN_PARENT_GOALS && normalized.length < 48) {
    appendUniqueGoal("parent");
  }

  return normalized;
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
- Use exact enum values for goal_type: "child" or "parent" (lowercase only).
- You MUST return at least ${MIN_CHILD_GOALS} goals with "goal_type":"child".
- You MUST return at least ${MIN_PARENT_GOALS} goals with "goal_type":"parent".
- Prefer returning 28-36 total goals unless assessment scope clearly requires more.
- Child goals should span skill acquisition, communication, social/play, behavior reduction/replacement, and adaptive behavior when supported by assessment findings.
- Parent goals should target caregiver implementation fidelity, behavior skills training participation, prompt/reinforcement accuracy, and home generalization support.
- Parent sub-distribution requirement: include at least ${MIN_PARENT_GOALS_PER_SUBTYPE} goals in each parent subtype:
  (1) caregiver implementation fidelity,
  (2) behavior skills training participation,
  (3) home/community generalization support.
- Parent goals must be concrete and measurable (avoid vague wording like "support child more").
- Avoid generic titles like "Parent Goal 1" or "Child Goal 1"; use behavior-specific, clinically meaningful titles.
- For every goal, include measurable baseline_data, target_criteria, mastery_criteria, maintenance_criteria, and generalization_criteria.
- If baseline/criteria are not explicit in the assessment, infer conservatively and state assumptions briefly.
- If document includes objective-level data settings (targets, phases, mastery/maintenance details), include them in objective_data_points.
- Ensure objective_data_points entries are actionable and specific to the goal target (not boilerplate duplicates).
- Do not output markdown, prose prefaces, or explanatory text outside the JSON object.
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
          max_tokens: 2200,
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
      ) as Awaited<ReturnType<typeof openai.chat.completions.create>> | null;

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
      const completedGoalMix = ensureMinimumGoalMix({
        goals: dedupedGoals,
        clientName: parsed.data.client_name,
        assessmentText: parsed.data.assessment_text.slice(0, MAX_ASSESSMENT_PROMPT_CHARS),
      });
      const normalizedResponse = responseSchema.safeParse({
        ...validated.data,
        goals: completedGoalMix,
      });
      if (!normalizedResponse.success) {
        retryHint =
          "Previous attempt produced goals that failed post-processing validation. Return concise JSON with complete required fields.";
        continue;
      }

      const { childCount, parentCount } = countGoalsByType(normalizedResponse.data.goals);
      if (childCount < MIN_CHILD_GOALS || parentCount < MIN_PARENT_GOALS) {
        retryHint =
          `Previous attempt only had ${childCount} child and ${parentCount} parent goals after post-processing. Regenerate full response with required minimums.`;
        continue;
      }

      return json(normalizedResponse.data, 200);
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
