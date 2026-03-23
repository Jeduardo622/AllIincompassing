import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { requireOrg } from "../_shared/org.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const MIN_CHILD_GOALS = 20;
const MIN_PARENT_GOALS = 6;
const MAX_GENERATION_ATTEMPTS = 2;
const OPENAI_ATTEMPT_TIMEOUT_MS = 20000;
const MAX_TEXT_CHARS = 12000;

const REVIEW_FLAGS = [
  "missing_baseline",
  "weak_measurement_definition",
  "unsupported_parent_goal",
  "ambiguous_mastery_threshold",
  "evidence_gap",
  "duplicate_risk",
  "clinician_confirmation_needed",
] as const;

const SYSTEM_PROMPT = `You are the FBA Care-Plan Specialist for an ABA platform.

Your job is to convert one uploaded, redacted Functional Behavior Assessment (FBA) plus extracted canonical checklist fields into a structured draft treatment plan for BCBA review.

You are a drafting specialist, not an autonomous clinician.

Primary objective:
- Produce one or more draft programs and a set of measurable draft goals grounded in the uploaded FBA.
- Output only structured content that can be reviewed and edited before publication.

Hard constraints:
1. Use only the supplied assessment evidence, extracted fields, approved checklist values, and organization guidance.
2. Do not invent diagnoses, risk claims, payer requirements, service authorizations, or family details not present in the source.
3. Do not include PHI beyond the provided client display name or first name, if present.
4. Do not output commentary, markdown, headings, or explanations outside the required JSON object.
5. Every program and every goal must be traceable to evidence.
6. If evidence is weak or incomplete, draft conservatively and add review flags.
7. Never present the output as final clinical judgment.
8. Never imply that drafts are published or approved.
9. Goal titles must be specific and non-generic.
10. Avoid duplicate goals and avoid boilerplate repeated across all goals.

Clinical drafting rules:
- Write in objective, implementation-ready ABA language.
- Prefer observable, measurable behavior descriptions over traits or vague labels.
- Child goals should target learner behavior or skill performance.
- Parent goals should target caregiver implementation, BST participation, procedural fidelity, reinforcement/prompting accuracy, and generalization support when supported by the assessment.
- Each goal must include concrete baseline, target, mastery, maintenance, and generalization criteria whenever the source allows.
- If criteria are not explicit in the source, infer conservatively and mark clinician confirmation needed.
- Objective data points must be behaviorally observable and practical for session data collection.

Evidence rules:
- Each program and each goal must include evidence_refs.
- Each evidence ref must point to the relevant extracted section or source snippet.
- If a goal is supported only weakly, include an evidence_gap or clinician_confirmation_needed review flag.

Review flag vocabulary:
- missing_baseline
- weak_measurement_definition
- unsupported_parent_goal
- ambiguous_mastery_threshold
- evidence_gap
- duplicate_risk
- clinician_confirmation_needed

Output rules:
- Return valid JSON only.
- Follow the schema exactly.
- No null arrays.
- No missing required fields.
- No extra keys.`;

const corsHeaders = (req: Request) => ({
  "Access-Control-Allow-Origin": resolveAllowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-request-id, x-correlation-id",
  Vary: "Origin",
});

const evidenceRefSchema = z
  .object({
    section_key: z.string().trim().min(1).max(160),
    source_span: z.string().trim().min(1).max(1200),
  })
  .strict();

const reviewFlagSchema = z.enum(REVIEW_FLAGS);

const checklistRowSchema = z
  .object({
    section_key: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(240),
    placeholder_key: z.string().trim().min(1).max(200),
    value_text: z.string().trim().max(2000).optional(),
    value_json: z.record(z.unknown()).optional(),
  })
  .strict();

const sourceEvidenceSnippetSchema = z
  .object({
    section_key: z.string().trim().min(1).max(160),
    snippet: z.string().trim().min(1).max(2000),
  })
  .strict();

const requestSchema = z
  .object({
    assessment_document_id: z.string().uuid(),
    client_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    client_display_name: z.string().trim().max(120).optional().default(""),
    organization_guidance: z.string().trim().max(MAX_TEXT_CHARS).optional().default(""),
    approved_checklist_rows: z.array(checklistRowSchema).max(300),
    extracted_canonical_fields: z.record(z.unknown()),
    assessment_summary: z.string().trim().min(20).max(MAX_TEXT_CHARS),
    source_evidence_snippets: z.array(sourceEvidenceSnippetSchema).min(1).max(200),
  })
  .strict();

const responseSchema = z
  .object({
    programs: z
      .array(
        z
          .object({
            name: z.string().trim().min(3).max(160),
            description: z.string().trim().min(10).max(2000),
            rationale: z.string().trim().min(10).max(2000),
            evidence_refs: z.array(evidenceRefSchema).min(1).max(20),
            review_flags: z.array(reviewFlagSchema).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    goals: z
      .array(
        z
          .object({
            program_name: z.string().trim().min(1).max(160),
            title: z.string().trim().min(3).max(220),
            description: z.string().trim().min(10).max(2000),
            original_text: z.string().trim().min(10).max(2500),
            goal_type: z.enum(["child", "parent"]),
            target_behavior: z.string().trim().min(1).max(500),
            measurement_type: z.string().trim().min(1).max(200),
            baseline_data: z.string().trim().min(1).max(1200),
            target_criteria: z.string().trim().min(1).max(1200),
            mastery_criteria: z.string().trim().min(1).max(1200),
            maintenance_criteria: z.string().trim().min(1).max(1200),
            generalization_criteria: z.string().trim().min(1).max(1200),
            objective_data_points: z.array(z.string().trim().min(1).max(600)).min(1).max(20),
            rationale: z.string().trim().min(10).max(2000),
            evidence_refs: z.array(evidenceRefSchema).min(1).max(20),
            review_flags: z.array(reviewFlagSchema).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    summary_rationale: z.string().trim().min(10).max(2500),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

type RequestPayload = z.infer<typeof requestSchema>;
type ResponsePayload = z.infer<typeof responseSchema>;
type DraftGoal = ResponsePayload["goals"][number];

type AttemptFailureReason =
  | "timeout"
  | "empty_content"
  | "invalid_json"
  | "schema_validation"
  | "duplicate_program_names"
  | "duplicate_goal_titles"
  | "missing_program_match"
  | "missing_evidence_refs"
  | "weak_evidence_missing_flags"
  | "goal_mix_mismatch";

const normalizeTitle = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const countGoalsByType = (goals: DraftGoal[]) => {
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

const findDuplicateGoalTitles = (goals: DraftGoal[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  goals.forEach((goal) => {
    const normalized = normalizeTitle(goal.title);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized)) {
      duplicates.add(goal.title.trim());
      return;
    }
    seen.add(normalized);
  });
  return Array.from(duplicates.values());
};

const findDuplicateProgramNames = (programs: ResponsePayload["programs"]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  programs.forEach((program) => {
    const normalized = program.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized) {
      return;
    }
    if (seen.has(normalized)) {
      duplicates.add(program.name.trim());
      return;
    }
    seen.add(normalized);
  });
  return Array.from(duplicates.values());
};

const hasWeakEvidence = (refs: Array<{ section_key: string; source_span: string }>): boolean =>
  refs.some((ref) => ref.section_key.toLowerCase().includes("unknown") || ref.source_span.trim().length < 24);

const hasWeakEvidenceWithoutFlags = (payload: ResponsePayload): boolean => {
  const needsWeakEvidenceFlag = (refs: Array<{ section_key: string; source_span: string }>, flags: string[]): boolean =>
    hasWeakEvidence(refs) &&
    !(flags.includes("evidence_gap") || flags.includes("clinician_confirmation_needed"));

  if (payload.programs.some((program) => needsWeakEvidenceFlag(program.evidence_refs, program.review_flags))) {
    return true;
  }
  return payload.goals.some((goal) => needsWeakEvidenceFlag(goal.evidence_refs, goal.review_flags));
};

const hasProgramNameCoverageGap = (payload: ResponsePayload): boolean => {
  const programNames = new Set(payload.programs.map((program) => program.name.trim().toLowerCase()));
  return payload.goals.some((goal) => !programNames.has(goal.program_name.trim().toLowerCase()));
};

const hasMissingEvidenceRefs = (payload: ResponsePayload): boolean => {
  if (payload.programs.some((program) => program.evidence_refs.length === 0)) {
    return true;
  }
  return payload.goals.some((goal) => goal.evidence_refs.length === 0);
};

const hasGoalMixMismatch = (payload: ResponsePayload): boolean => {
  const { childCount, parentCount } = countGoalsByType(payload.goals);
  return childCount < MIN_CHILD_GOALS || parentCount < MIN_PARENT_GOALS;
};

const trim = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3).trimEnd()}...`;
};

const buildUserPrompt = (payload: RequestPayload): string => {
  const rowsJson = JSON.stringify(payload.approved_checklist_rows, null, 2);
  const canonicalJson = JSON.stringify(payload.extracted_canonical_fields, null, 2);
  const evidenceJson = JSON.stringify(payload.source_evidence_snippets, null, 2);
  return `Generate draft programs and goals from one uploaded FBA.

Context:
ASSESSMENT_DOCUMENT_ID: ${payload.assessment_document_id}
CLIENT_ID: ${payload.client_id}
ORG_ID: ${payload.organization_id}
CLIENT_DISPLAY_NAME: ${payload.client_display_name || "Not provided"}

ORGANIZATION_GUIDANCE:
${payload.organization_guidance || "No additional guidance provided."}

APPROVED_CHECKLIST_ROWS:
${rowsJson}

EXTRACTED_CANONICAL_FIELDS:
${canonicalJson}

ASSESSMENT_SUMMARY:
${payload.assessment_summary}

SOURCE_EVIDENCE_SNIPPETS:
${evidenceJson}

Generation requirements:
- Generate 1 to 5 programs only if clearly supported by the assessment.
- Generate both child and parent goals when the evidence supports them.
- Prefer quality and evidence alignment over high goal volume.
- Do not create goals unsupported by the uploaded FBA.
- Make each goal clinically specific, measurable, and implementation-ready.
- Avoid duplicate goals across programs.
- For weakly supported content, draft conservatively and add review_flags.
- Return only valid JSON matching the required schema.`;
};

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

const buildFallbackResponse = (payload: RequestPayload, reason: string): ResponsePayload => {
  const learnerName = payload.client_display_name || "the learner";
  const snippet = trim(payload.source_evidence_snippets[0]?.snippet || payload.assessment_summary, 180);
  const sectionKey = payload.source_evidence_snippets[0]?.section_key || "assessment_summary";
  const programName = "FBA Draft Program - Clinician Review Required";
  const programs = [
    {
      name: programName,
      description: "Conservative fallback draft generated after model timeout for BCBA review and revision.",
      rationale:
        "Fallback content is intentionally conservative and flagged for clinician confirmation before any promotion step.",
      evidence_refs: [{ section_key: sectionKey, source_span: snippet }],
      review_flags: ["clinician_confirmation_needed", "evidence_gap"] as Array<(typeof REVIEW_FLAGS)[number]>,
    },
  ];

  const goals: DraftGoal[] = [];
  for (let index = 1; index <= MIN_CHILD_GOALS; index += 1) {
    goals.push({
      program_name: programName,
      title: `Child Goal ${index}: Functional Skill Target`,
      description:
        `${learnerName} will demonstrate an observable replacement skill from assessment findings with clinician-confirmed criteria.`,
      original_text: `Fallback child goal based on source snippet: ${snippet}`,
      goal_type: "child",
      target_behavior: "Observable replacement response aligned to assessment findings",
      measurement_type: "Frequency and percent of independent opportunities",
      baseline_data: "Baseline requires BCBA confirmation from source evidence.",
      target_criteria: "Target performance requires BCBA confirmation before implementation.",
      mastery_criteria: "Mastery threshold requires BCBA confirmation before publication.",
      maintenance_criteria: "Maintenance schedule requires BCBA confirmation before publication.",
      generalization_criteria: "Generalization settings and partners require BCBA confirmation.",
      objective_data_points: [
        "Record opportunity count, independent responses, and prompt level each session.",
        "Track trend over time and confirm operational definition with BCBA.",
      ],
      rationale: "Conservative fallback target created to preserve draft workflow continuity.",
      evidence_refs: [{ section_key: sectionKey, source_span: snippet }],
      review_flags: ["clinician_confirmation_needed", "evidence_gap"],
    });
  }
  for (let index = 1; index <= MIN_PARENT_GOALS; index += 1) {
    goals.push({
      program_name: programName,
      title: `Parent Goal ${index}: Caregiver Implementation Fidelity`,
      description:
        "Caregiver will participate in implementation coaching and demonstrate procedural steps with BCBA-confirmed thresholds.",
      original_text: `Fallback parent goal based on source snippet: ${snippet}`,
      goal_type: "parent",
      target_behavior: "Caregiver procedural fidelity and coached implementation participation",
      measurement_type: "Percent of required steps completed correctly",
      baseline_data: "Baseline caregiver fidelity requires BCBA confirmation from source evidence.",
      target_criteria: "Target fidelity threshold requires BCBA confirmation before implementation.",
      mastery_criteria: "Mastery threshold requires BCBA confirmation before publication.",
      maintenance_criteria: "Maintenance probe schedule requires BCBA confirmation before publication.",
      generalization_criteria: "Generalization across routines requires BCBA confirmation.",
      objective_data_points: [
        "Score fidelity checklist during coached sessions.",
        "Track independent caregiver step completion across routines.",
      ],
      rationale: "Conservative fallback caregiver target to preserve staged drafting without publishing.",
      evidence_refs: [{ section_key: sectionKey, source_span: snippet }],
      review_flags: ["clinician_confirmation_needed", "evidence_gap"],
    });
  }

  return {
    programs,
    goals,
    summary_rationale: `Fallback draft generated due to model generation issue: ${reason}.`,
    confidence: "low",
  };
};

const parseAndValidateCandidate = (
  rawContent: string,
): { ok: true; payload: ResponsePayload } | { ok: false; reason: AttemptFailureReason } => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stripCodeFences(rawContent));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const validated = responseSchema.safeParse(candidate);
  if (!validated.success) {
    return { ok: false, reason: "schema_validation" };
  }

  const payload = validated.data;
  if (findDuplicateProgramNames(payload.programs).length > 0) {
    return { ok: false, reason: "duplicate_program_names" };
  }
  if (findDuplicateGoalTitles(payload.goals).length > 0) {
    return { ok: false, reason: "duplicate_goal_titles" };
  }
  if (hasProgramNameCoverageGap(payload)) {
    return { ok: false, reason: "missing_program_match" };
  }
  if (hasMissingEvidenceRefs(payload)) {
    return { ok: false, reason: "missing_evidence_refs" };
  }
  if (hasWeakEvidenceWithoutFlags(payload)) {
    return { ok: false, reason: "weak_evidence_missing_flags" };
  }
  if (hasGoalMixMismatch(payload)) {
    return { ok: false, reason: "goal_mix_mismatch" };
  }

  return { ok: true, payload };
};

const buildRetryHint = (reason: AttemptFailureReason): string => {
  switch (reason) {
    case "timeout":
      return "Previous attempt timed out. Return concise valid JSON that matches the schema exactly.";
    case "empty_content":
      return "Previous attempt returned empty content. Return only one JSON object and no commentary.";
    case "invalid_json":
      return "Previous attempt returned invalid JSON. Return valid JSON only.";
    case "schema_validation":
      return "Previous attempt failed strict schema validation. Include all required keys with no extras.";
    case "duplicate_program_names":
      return "Previous attempt had duplicate program names. Keep each programs[].name unique.";
    case "duplicate_goal_titles":
      return "Previous attempt had duplicate goal titles. All goal titles must be unique in this response.";
    case "missing_program_match":
      return "Each goal.program_name must match one programs[].name value after trim/case normalization.";
    case "missing_evidence_refs":
      return "Every program and goal must include non-empty evidence_refs.";
    case "weak_evidence_missing_flags":
      return "Weakly supported items must include evidence_gap or clinician_confirmation_needed in review_flags.";
    case "goal_mix_mismatch":
      return `Ensure at least ${MIN_CHILD_GOALS} child goals and ${MIN_PARENT_GOALS} parent goals.`;
  }
};

const json = (req: Request, payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });

export async function handleGenerateProgramGoals(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);
    await requireOrg(db);

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return json(req, { error: "Invalid request body" }, 400);
    }

    const payload = parsed.data;
    const attemptFailures: AttemptFailureReason[] = [];
    let retryHint: string | undefined;
    let lastFailureReason = "unknown";
    const userPromptBase = buildUserPrompt(payload);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const userPrompt = retryHint
        ? `${userPromptBase}\n\nIMPORTANT RETRY FIX:\n${retryHint}`
        : userPromptBase;

      const completion = await withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.1,
          max_tokens: 3200,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        OPENAI_ATTEMPT_TIMEOUT_MS,
      ) as Awaited<ReturnType<typeof openai.chat.completions.create>> | null;

      if (!completion) {
        const reason: AttemptFailureReason = "timeout";
        attemptFailures.push(reason);
        lastFailureReason = `attempt ${attempt} timed out after ${OPENAI_ATTEMPT_TIMEOUT_MS}ms`;
        retryHint = buildRetryHint(reason);
        continue;
      }

      const rawContent = completion.choices[0]?.message?.content;
      if (!rawContent) {
        const reason: AttemptFailureReason = "empty_content";
        attemptFailures.push(reason);
        lastFailureReason = `attempt ${attempt} returned empty content`;
        retryHint = buildRetryHint(reason);
        continue;
      }

      const candidate = parseAndValidateCandidate(rawContent);
      if (!candidate.ok) {
        attemptFailures.push(candidate.reason);
        lastFailureReason = `attempt ${attempt} failed with ${candidate.reason}`;
        retryHint = buildRetryHint(candidate.reason);
        continue;
      }

      return json(req, candidate.payload, 200);
    }

    const allTimeouts = attemptFailures.length > 0 && attemptFailures.every((reason) => reason === "timeout");
    if (allTimeouts) {
      const fallback = buildFallbackResponse(payload, `timeout-only failure (${MAX_GENERATION_ATTEMPTS} attempts)`);
      return json(req, fallback, 200);
    }

    const failureSet = Array.from(new Set(attemptFailures.values())).join(",");
    return json(req, {
      error:
        `Generated draft failed after ${MAX_GENERATION_ATTEMPTS} attempts. Last failure: ${lastFailureReason}. ` +
        `Failure categories: ${failureSet || "none"}.`,
    }, 502);
  } catch (error) {
    console.error("generate-program-goals error", error);
    return json(req, { error: "Failed to generate draft" }, 500);
  }
}

export const __TESTING__ = {
  buildUserPrompt,
  parseAndValidateCandidate,
  hasWeakEvidenceWithoutFlags,
  countGoalsByType,
  buildFallbackResponse,
  findDuplicateGoalTitles,
  requestSchema,
  responseSchema,
  REVIEW_FLAGS,
};

Deno.serve(handleGenerateProgramGoals);
