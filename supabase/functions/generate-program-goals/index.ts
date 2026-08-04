import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { requireOrg } from "../_shared/org.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";
import {
  CALOPTIMA_LEDGER_MODEL_SNAPSHOT,
  LedgerPreparationError,
  ledgerGenerationSchema,
  prepareLedgerGeneration,
  type LedgerGenerationCorrelation,
} from "./ledger.ts";

const createOpenAIClient = (): OpenAI => new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const MAX_GENERATION_ATTEMPTS = 2;
const OPENAI_ATTEMPT_TIMEOUT_MS = 20000;
const MAX_TEXT_CHARS = 12000;
const MAX_GENERATED_PROGRAMS = 50;
const MAX_GENERATED_GOALS = 500;

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
- Each evidence ref must copy an exact section_key and opaque source_span token supplied with the relevant source evidence.
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
    source_span: z.string().trim().min(1).max(1200).optional().default("unbound-source"),
    value_text: z.string().trim().max(2000).optional(),
    value_json: z.record(z.unknown()).optional(),
  })
  .strict();

const sourceEvidenceSnippetSchema = z
  .object({
    section_key: z.string().trim().min(1).max(160),
    snippet: z.string().trim().min(1).max(2000),
    source_span: z.string().trim().min(1).max(1200).optional().default("unbound-source"),
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
      .max(MAX_GENERATED_PROGRAMS),
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
      .max(MAX_GENERATED_GOALS),
    summary_rationale: z.string().trim().min(10).max(2500),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

type EvidenceRef = { section_key: string; source_span: string };
type ReviewFlag = (typeof REVIEW_FLAGS)[number];
type RequestPayload = {
  assessment_document_id: string;
  client_id: string;
  organization_id: string;
  client_display_name: string;
  organization_guidance: string;
  approved_checklist_rows: Array<{
    section_key: string;
    label: string;
    placeholder_key: string;
    source_span: string;
    value_text?: string;
    value_json?: Record<string, unknown>;
  }>;
  extracted_canonical_fields: Record<string, unknown>;
  assessment_summary: string;
  source_evidence_snippets: Array<{ section_key: string; snippet: string; source_span: string }>;
};
type DraftProgram = {
  name: string;
  description: string;
  rationale: string;
  evidence_refs: EvidenceRef[];
  review_flags: ReviewFlag[];
};
type DraftGoal = {
  program_name: string;
  title: string;
  description: string;
  original_text: string;
  goal_type: "child" | "parent";
  target_behavior: string;
  measurement_type: string;
  baseline_data: string;
  target_criteria: string;
  mastery_criteria: string;
  maintenance_criteria: string;
  generalization_criteria: string;
  objective_data_points: string[];
  rationale: string;
  evidence_refs: EvidenceRef[];
  review_flags: ReviewFlag[];
};
type ResponsePayload = {
  programs: DraftProgram[];
  goals: DraftGoal[];
  summary_rationale: string;
  confidence: "low" | "medium" | "high";
};

type RequestClient = ReturnType<typeof createRequestClient>;
type LegacyAssessmentLookupInput = {
  assessmentDocumentId: string;
  organizationId: string;
  clientId: string;
};
type CompletionInvocationResult =
  | ResponsePayload
  | {
    response: ResponsePayload;
    inputTokens?: number;
    outputTokens?: number;
    errorClass?: string | null;
    errorCode?: string | null;
  };
type CompletionUsageObserver = (inputTokens: number, outputTokens: number) => void;
type GenerateProgramGoalsDependencies = {
  createRequestClient: typeof createRequestClient;
  getUserOrThrow: typeof getUserOrThrow;
  requireOrg: typeof requireOrg;
  lookupLegacyAssessment: (
    db: RequestClient,
    input: LegacyAssessmentLookupInput,
  ) => Promise<Record<string, unknown> | null>;
  invokeCompletion: (
    payload: RequestPayload,
    ledgerBound: boolean,
    onUsage?: CompletionUsageObserver,
  ) => Promise<CompletionInvocationResult>;
  requireLedgerAdvisoryRuntime: () => Promise<void>;
};
type RequestResolution =
  | { kind: "ledger"; payload: LedgerGenerationCorrelation }
  | { kind: "legacy"; payload: RequestPayload }
  | { kind: "error"; status: number; code: "generation_scope_denied"; binding: "ledger" | "legacy" }
  | { kind: "error"; status: number; code: "invalid_request_body" };

class GenerationAttemptsExhaustedError extends Error {
  override name = "GenerationAttemptsExhaustedError";
}

const CALOPTIMA_GOAL_FIELD_KEYS = new Set([
  "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
  "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
  "CALOPTIMA_FBA_PARENT_GOALS",
]);

class LedgerGenerationError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "LedgerGenerationError";
  }
}

const configuredLedgerRuntimeMode = (): "disabled" | "shadow" | "advisory" => {
  const configured = (Deno.env.get("AGENT_WORK_LEDGER_RUNTIME_MODE") ?? "disabled").trim().toLowerCase();
  return configured === "shadow" || configured === "advisory" ? configured : "disabled";
};

async function requireLedgerAdvisoryRuntime(): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("load_agent_work_runtime_policy", {
    p_mode_input: configuredLedgerRuntimeMode(),
  });
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (
    error || !row || row.authoritative !== true || row.runtimeMode !== "advisory" ||
    row.actionsDisabled !== false || row.killSwitchEnabled !== false
  ) {
    throw new LedgerGenerationError("runtime_mode_not_advisory", 503);
  }
}

const compactEvidence = (value: unknown, max = 1800): string => {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return serialized.replace(/\s+/g, " ").trim().slice(0, max);
};

const selectStructuredEvidenceContent = (row: Record<string, unknown>): unknown =>
  row.payload ?? row.source_span;

async function loadAuthoritativeCalOptimaPayload(
  db: ReturnType<typeof createRequestClient>,
  input: {
    assessmentDocumentId: string;
    organizationId: string;
    clientId: string;
  },
): Promise<RequestPayload> {
  const { data: document, error: documentError } = await db
    .from("assessment_documents")
    .select("id,organization_id,client_id,template_type")
    .eq("id", input.assessmentDocumentId)
    .eq("organization_id", input.organizationId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (documentError || !document || document.template_type !== "caloptima_fba") {
    throw new LedgerGenerationError("authoritative_document_scope_denied");
  }

  const [checklistResult, structuredResult] = await Promise.all([
    db.from("assessment_checklist_items")
      .select("id,section_key,label,placeholder_key,value_text,value_json,status,required")
      .eq("assessment_document_id", input.assessmentDocumentId)
      .eq("organization_id", input.organizationId)
      .eq("client_id", input.clientId),
    db.from("assessment_structured_sections")
      .select("id,section_key,field_key,payload,source_span,status,required")
      .eq("assessment_document_id", input.assessmentDocumentId)
      .eq("organization_id", input.organizationId)
      .eq("client_id", input.clientId),
  ]);
  if (checklistResult.error || structuredResult.error) {
    throw new LedgerGenerationError("authoritative_evidence_unavailable", 503);
  }

  const checklistRows = (checklistResult.data ?? []) as Array<Record<string, unknown>>;
  const structuredRows = (structuredResult.data ?? []) as Array<Record<string, unknown>>;
  const requiredChecklist = checklistRows.filter((row) => row.required === true);
  const requiredStructured = structuredRows.filter((row) => row.required === true);
  const approvedGoalSections = structuredRows.filter((row) =>
    row.status === "approved" && typeof row.field_key === "string" && CALOPTIMA_GOAL_FIELD_KEYS.has(row.field_key)
  );
  if (
    requiredChecklist.length === 0 || requiredStructured.length === 0 ||
    requiredChecklist.some((row) => row.status !== "approved") ||
    requiredStructured.some((row) => row.status !== "approved") ||
    approvedGoalSections.length === 0
  ) {
    throw new LedgerGenerationError("approved_evidence_precondition_failed");
  }

  const approvedChecklistRows = checklistRows.filter((row) => row.status === "approved").map((row) => ({
    section_key: String(row.section_key ?? "assessment"),
    label: String(row.label ?? "Approved evidence"),
    placeholder_key: String(row.placeholder_key ?? "approved_evidence"),
    source_span: `assessment_checklist_item:${String(row.id)}`,
    ...(typeof row.value_text === "string" && row.value_text.trim() ? { value_text: row.value_text.trim() } : {}),
    ...(row.value_json && typeof row.value_json === "object" ? { value_json: row.value_json as Record<string, unknown> } : {}),
  }));
  const extractedCanonicalFields = Object.fromEntries(structuredRows
    .filter((row) => row.status === "approved" && typeof row.field_key === "string")
    .sort((left, right) => String(left.field_key).localeCompare(String(right.field_key)))
    .map((row) => [String(row.field_key), row.payload ?? {}]));
  const checklistEvidenceSnippets = checklistRows
    .filter((row) => row.status === "approved")
    .map((row) => ({
      section_key: String(row.section_key ?? row.placeholder_key ?? "assessment"),
      snippet: compactEvidence(row.value_text ?? row.value_json),
      source_span: `assessment_checklist_item:${String(row.id)}`,
    }));
  const structuredEvidenceSnippets = structuredRows
    .filter((row) => row.status === "approved")
    .map((row) => ({
      section_key: String(row.section_key ?? "structured_evidence"),
      snippet: compactEvidence(selectStructuredEvidenceContent(row)),
      source_span: `assessment_structured_section:${String(row.id)}`,
    }))
    .filter((row) => row.snippet.length > 0);
  const sourceEvidenceSnippets = [...checklistEvidenceSnippets, ...structuredEvidenceSnippets]
    .filter((row) => row.snippet.length > 0)
    .slice(0, 120);
  const assessmentSummary = approvedChecklistRows
    .map((row) => compactEvidence(row.value_text ?? row.value_json))
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_TEXT_CHARS);
  const fallbackSummary = sourceEvidenceSnippets.map((row) => row.snippet).join(" ").slice(0, MAX_TEXT_CHARS);

  return requestSchema.parse({
    assessment_document_id: input.assessmentDocumentId,
    client_id: input.clientId,
    organization_id: input.organizationId,
    client_display_name: "",
    organization_guidance: "",
    approved_checklist_rows: approvedChecklistRows,
    extracted_canonical_fields: extractedCanonicalFields,
    assessment_summary: assessmentSummary.length >= 20 ? assessmentSummary : fallbackSummary,
    source_evidence_snippets: sourceEvidenceSnippets,
  });
}

async function lookupLegacyAssessmentDocument(
  db: RequestClient,
  input: LegacyAssessmentLookupInput,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from("assessment_documents")
    .select("id")
    .eq("id", input.assessmentDocumentId)
    .eq("organization_id", input.organizationId)
    .eq("client_id", input.clientId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as Record<string, unknown>;
}

async function loadPersistedCalOptimaDraftPacket(
  actorUserId: string,
  input: LedgerGenerationCorrelation,
): Promise<{ packet: ResponsePayload; outputHash: string; packetHash: string }> {
  const { data, error } = await supabaseAdmin.rpc("read_agent_work_caloptima_draft_packet", {
    p_actor_user_id: actorUserId,
    p_organization_id: input.organizationId,
    p_client_id: input.clientId,
    p_work_item_id: input.workItemId,
  });
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (
    error || !row || typeof row.output_hash !== "string" ||
    typeof row.packet_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(row.output_hash) ||
    !/^[0-9a-f]{64}$/.test(row.packet_hash)
  ) {
    throw new LedgerGenerationError("persisted_draft_packet_unavailable", 503);
  }
  const parsed = responseSchema.safeParse(row.packet);
  if (!parsed.success) {
    throw new LedgerGenerationError("persisted_draft_packet_invalid", 503);
  }
  return { packet: parsed.data, outputHash: row.output_hash, packetHash: row.packet_hash };
}

export async function verifyLedgerReplayPacket(
  packet: ResponsePayload,
  persistedOutputHash: string,
  persistedPacketHash: string,
  expectedOutputHash: string | null,
): Promise<ResponsePayload> {
  if (
    !expectedOutputHash || persistedOutputHash !== expectedOutputHash ||
    persistedPacketHash !== persistedOutputHash
  ) {
    throw new LedgerGenerationError("persisted_draft_packet_hash_mismatch", 409);
  }
  return packet;
}

const estimateModelCost = (inputTokens: number, outputTokens: number): number =>
  Number(((inputTokens * 2.5 + outputTokens * 10) / 1_000_000).toFixed(8));

async function recordLedgerModelResult(
  context: {
    correlation: LedgerGenerationCorrelation;
    actorUserId: string;
    stepId: string;
    attemptId: string;
  },
  output: ResponsePayload,
  inputTokens: number,
  outputTokens: number,
  errorClass: string | null,
  errorCode: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("complete_agent_work_caloptima_model_attempt", {
    p_actor_user_id: context.actorUserId,
    p_organization_id: context.correlation.organizationId,
    p_client_id: context.correlation.clientId,
    p_work_item_id: context.correlation.workItemId,
    p_step_id: context.stepId,
    p_attempt_id: context.attemptId,
    p_draft_packet: output,
    p_input_token_count: inputTokens,
    p_output_token_count: outputTokens,
    p_computed_cost: estimateModelCost(inputTokens, outputTokens),
    p_error_class: errorClass,
    p_error_code: errorCode,
  });
  if (error) throw new LedgerGenerationError("attempt_completion_failed", 503);
}

type AttemptFailureReason =
  | "timeout"
  | "empty_content"
  | "invalid_json"
  | "schema_validation"
  | "duplicate_program_names"
  | "duplicate_goal_titles"
  | "missing_program_match"
  | "missing_evidence_refs"
  | "unbound_evidence_ref"
  | "weak_evidence_missing_flags";

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

const hasUnboundEvidenceRef = (output: ResponsePayload, input: RequestPayload): boolean => {
  const catalog = new Set<string>();
  for (const row of input.approved_checklist_rows) {
    catalog.add(`${row.section_key}\u0000${row.source_span}`);
    catalog.add(`${row.placeholder_key}\u0000${row.source_span}`);
  }
  for (const row of input.source_evidence_snippets) {
    catalog.add(`${row.section_key}\u0000${row.source_span}`);
  }
  return [...output.programs, ...output.goals].some((item) =>
    item.evidence_refs.some((ref) => !catalog.has(`${ref.section_key}\u0000${ref.source_span}`))
  );
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
- Generate the full set of distinct programs clearly supported by the assessment evidence.
- Generate both child and parent goals when the evidence supports them.
- Prefer quality and evidence alignment over arbitrary count limits.
- Keep the result within ${MAX_GENERATED_PROGRAMS} programs and ${MAX_GENERATED_GOALS} goals by merging near-duplicates if necessary.
- Do not create goals unsupported by the uploaded FBA.
- Make each goal clinically specific, measurable, and implementation-ready.
- Avoid duplicate goals across programs.
- For weakly supported content, draft conservatively and add review_flags.
- Copy evidence_refs section_key and source_span exactly from the supplied evidence catalog.
- Return only valid JSON matching the required schema.`;
};

const buildCompletionRequest = (userPrompt: string, ledgerBound: boolean) => ({
  model: ledgerBound ? CALOPTIMA_LEDGER_MODEL_SNAPSHOT.model : "gpt-4o",
  temperature: ledgerBound ? CALOPTIMA_LEDGER_MODEL_SNAPSHOT.temperature : 0.1,
  max_tokens: 3200,
  messages: [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ],
  ...(ledgerBound ? { tools: [] } : {}),
});

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
  const sourceSpan = payload.source_evidence_snippets[0]?.source_span ||
    payload.approved_checklist_rows[0]?.source_span || "unbound-source";
  const programName = "FBA Draft Program - Clinician Review Required";
  const programs = [
    {
      name: programName,
      description: "Conservative fallback draft generated after model timeout for BCBA review and revision.",
      rationale:
        "Fallback content is intentionally conservative and flagged for clinician confirmation before any promotion step.",
      evidence_refs: [{ section_key: sectionKey, source_span: sourceSpan }],
      review_flags: ["clinician_confirmation_needed", "evidence_gap"] as Array<(typeof REVIEW_FLAGS)[number]>,
    },
  ];

  const evidenceText =
    `${payload.assessment_summary}\n${payload.source_evidence_snippets.map((entry) => entry.snippet).join("\n")}`
      .toLowerCase();
  const shouldIncludeParentGoal = /\b(parent|caregiver|family|guardian)\b/.test(evidenceText);
  const goals: DraftGoal[] = [
    {
      program_name: programName,
      title: "Child Goal: Functional Skill Target",
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
      evidence_refs: [{ section_key: sectionKey, source_span: sourceSpan }],
      review_flags: ["clinician_confirmation_needed", "evidence_gap"],
    },
  ];
  if (shouldIncludeParentGoal) {
    goals.push({
      program_name: programName,
      title: "Parent Goal: Caregiver Implementation Fidelity",
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
      evidence_refs: [{ section_key: sectionKey, source_span: sourceSpan }],
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
  authoritativeInput?: RequestPayload,
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
  if (authoritativeInput && hasUnboundEvidenceRef(payload, authoritativeInput)) {
    return { ok: false, reason: "unbound_evidence_ref" };
  }
  if (hasWeakEvidenceWithoutFlags(payload)) {
    return { ok: false, reason: "weak_evidence_missing_flags" };
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
    case "unbound_evidence_ref":
      return "Every evidence ref must copy an exact section_key and source_span token from the supplied evidence.";
    case "weak_evidence_missing_flags":
      return "Weakly supported items must include evidence_gap or clinician_confirmation_needed in review_flags.";
  }
};

const normalizeCompletionResult = (
  result: CompletionInvocationResult,
): { response: ResponsePayload; inputTokens: number; outputTokens: number; errorClass: string | null; errorCode: string | null } => {
  if ("programs" in result && "goals" in result && "summary_rationale" in result && "confidence" in result) {
    return {
      response: result,
      inputTokens: 0,
      outputTokens: 0,
      errorClass: null,
      errorCode: null,
    };
  }

  return {
    response: result.response,
    inputTokens: Math.max(0, Number(result.inputTokens ?? 0)),
    outputTokens: Math.max(0, Number(result.outputTokens ?? 0)),
    errorClass: result.errorClass ?? null,
    errorCode: result.errorCode ?? null,
  };
};

const resolveGenerationRequest = (body: unknown, organizationId: string): RequestResolution => {
  const ledgerParsed = ledgerGenerationSchema.safeParse(body);
  if (ledgerParsed.success) {
    if (ledgerParsed.data.organizationId !== organizationId) {
      return { kind: "error", status: 403, code: "generation_scope_denied", binding: "ledger" };
    }
    return { kind: "ledger", payload: ledgerParsed.data };
  }

  const legacyParsed = requestSchema.safeParse(body);
  if (legacyParsed.success) {
    if (legacyParsed.data.organization_id !== organizationId) {
      return { kind: "error", status: 403, code: "generation_scope_denied", binding: "legacy" };
    }
    return { kind: "legacy", payload: legacyParsed.data };
  }

  return { kind: "error", status: 400, code: "invalid_request_body" };
};

const json = (req: Request, payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });

const deriveStableLedgerRequestId = (workItemId: string): string =>
  `caloptima-ledger.${workItemId}`;

async function invokeCompletionWithRetries(
  payload: RequestPayload,
  ledgerBound: boolean,
  onUsage?: CompletionUsageObserver,
): Promise<CompletionInvocationResult> {
  const attemptFailures: AttemptFailureReason[] = [];
  const openai = createOpenAIClient();
  let retryHint: string | undefined;
  let ledgerInputTokens = 0;
  let ledgerOutputTokens = 0;
  const userPromptBase = buildUserPrompt(payload);

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const userPrompt = retryHint
      ? `${userPromptBase}\n\nIMPORTANT RETRY FIX:\n${retryHint}`
      : userPromptBase;

    const completion = await withTimeout(
      openai.chat.completions.create(
        buildCompletionRequest(userPrompt, ledgerBound),
      ),
      OPENAI_ATTEMPT_TIMEOUT_MS,
    ) as Awaited<ReturnType<typeof openai.chat.completions.create>> | null;

    if (!completion) {
      const reason: AttemptFailureReason = "timeout";
      attemptFailures.push(reason);
      retryHint = buildRetryHint(reason);
      continue;
    }

    if (!("choices" in completion)) {
      const reason: AttemptFailureReason = "empty_content";
      attemptFailures.push(reason);
      retryHint = buildRetryHint(reason);
      continue;
    }

    const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    ledgerInputTokens += Math.max(0, Number(usage?.prompt_tokens ?? 0));
    ledgerOutputTokens += Math.max(0, Number(usage?.completion_tokens ?? 0));
    onUsage?.(ledgerInputTokens, ledgerOutputTokens);

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      const reason: AttemptFailureReason = "empty_content";
      attemptFailures.push(reason);
      retryHint = buildRetryHint(reason);
      continue;
    }

    const candidate = parseAndValidateCandidate(rawContent, payload);
    if (!candidate.ok) {
      attemptFailures.push(candidate.reason);
      retryHint = buildRetryHint(candidate.reason);
      continue;
    }

    return {
      response: candidate.payload,
      inputTokens: ledgerInputTokens,
      outputTokens: ledgerOutputTokens,
      errorClass: null,
      errorCode: null,
    };
  }

  const finalReason = attemptFailures.at(-1) ?? "validation_failed";
  const allTimeouts = attemptFailures.length > 0 && attemptFailures.every((reason) => reason === "timeout");
  if (ledgerBound || allTimeouts) {
    return {
      response: buildFallbackResponse(
        payload,
        allTimeouts ? `timeout-only failure (${MAX_GENERATION_ATTEMPTS} attempts)` : `${finalReason} (${MAX_GENERATION_ATTEMPTS} attempts)`,
      ),
      inputTokens: ledgerInputTokens,
      outputTokens: ledgerOutputTokens,
      errorClass: allTimeouts ? "provider" : ledgerBound ? "model_output" : null,
      errorCode: ledgerBound || allTimeouts ? finalReason : null,
    };
  }

  const failureSet = Array.from(new Set(attemptFailures.values())).join(",");
  throw new GenerationAttemptsExhaustedError(
    `Generated draft failed after ${MAX_GENERATION_ATTEMPTS} attempts. Last failure: ${finalReason}. ` +
      `Failure categories: ${failureSet || "none"}.`,
  );
}

const productionDependencies: GenerateProgramGoalsDependencies = {
  createRequestClient,
  getUserOrThrow,
  requireOrg,
  lookupLegacyAssessment: lookupLegacyAssessmentDocument,
  invokeCompletion: invokeCompletionWithRetries,
  requireLedgerAdvisoryRuntime,
};

export function createGenerateProgramGoalsHandler(
  dependencies: GenerateProgramGoalsDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return async function handleGenerateProgramGoals(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (req.method !== "POST") {
      return json(req, { error: "Method not allowed" }, 405);
    }

    let ledgerResultContext: {
      correlation: LedgerGenerationCorrelation;
      actorUserId: string;
      stepId: string;
      attemptId: string;
      payload: RequestPayload;
    } | null = null;
    let ledgerResultRecorded = false;
    let ledgerInputTokens = 0;
    let ledgerOutputTokens = 0;

    try {
      const db = dependencies.createRequestClient(req);
      const user = await dependencies.getUserOrThrow(db);
      const organizationId = await dependencies.requireOrg(db);
      const body = await req.json();
      const resolved = resolveGenerationRequest(body, organizationId);

      if (resolved.kind === "error") {
        if (resolved.code === "generation_scope_denied") {
          const error = resolved.binding === "ledger"
            ? "Ledger-bound draft generation denied"
            : "Legacy-bound draft generation denied";
          return json(req, { error, code: resolved.code }, resolved.status);
        }
        return json(req, { error: resolved.code }, resolved.status);
      }

      let payload: RequestPayload;
      let ledgerBound = false;

      if (resolved.kind === "ledger") {
        ledgerBound = true;
        const requestId = deriveStableLedgerRequestId(resolved.payload.workItemId);
        const requestIdCandidate = req.headers.get("x-request-id")?.trim() ?? "";
        if (
          (requestIdCandidate && requestIdCandidate !== requestId) ||
          resolved.payload.correlationId !== requestId
        ) {
          return json(req, { error: "stable_request_id_mismatch" }, 409);
        }
        await dependencies.requireLedgerAdvisoryRuntime();
        const prepared = await prepareLedgerGeneration({
          actorUserId: user.id,
          requestId,
          correlation: resolved.payload,
        }, {
          loadAuthoritativePayload: ({ assessmentDocumentId, organizationId, clientId }) =>
            loadAuthoritativeCalOptimaPayload(db, { assessmentDocumentId, organizationId, clientId }),
          beginAttempt: async (input) => {
            const { data, error } = await supabaseAdmin.rpc(
              "begin_agent_work_caloptima_model_attempt",
              {
                p_actor_user_id: input.actorUserId,
                p_organization_id: input.correlation.organizationId,
                p_client_id: input.correlation.clientId,
                p_work_item_id: input.correlation.workItemId,
                p_correlation_id: input.correlation.correlationId,
                p_request_id: input.requestId,
              },
            );
            const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
            const authoritative = !error && !!row &&
              row.workflow_key === "assessment.caloptima.prepare_draft_review" &&
              row.workflow_version === 1 && row.step_key === "suggest_draft_packet" &&
              row.provider === input.provider && row.model === input.model &&
              row.prompt_version === input.promptVersion && row.tool_version === input.toolVersion &&
              row.model_request_schema_version === input.modelRequestSchemaVersion &&
              row.pricing_version === input.pricingVersion && Number(row.temperature) === input.temperature &&
              Array.isArray(row.allowed_tools) && row.allowed_tools.length === 0 &&
              Array.isArray(row.guarded_tools) && row.guarded_tools.length === 0 &&
              (row.attempt_status === "running" || row.attempt_status === "completed" ||
                row.attempt_status === "failed");
            return {
              authoritative,
              stepId: typeof row?.step_id === "string" ? row.step_id : "",
              attemptId: typeof row?.attempt_id === "string" ? row.attempt_id : "",
              attemptStatus: row?.attempt_status === "running" || row?.attempt_status === "completed" ||
                  row?.attempt_status === "failed"
                ? row.attempt_status
                : "running",
              outputHash: typeof row?.output_hash === "string" ? row.output_hash : null,
            };
          },
          settleAttemptFailure: async (input) => {
            const { data, error } = await supabaseAdmin.rpc(
              "fail_agent_work_caloptima_model_attempt",
              {
                p_actor_user_id: input.actorUserId,
                p_organization_id: input.correlation.organizationId,
                p_client_id: input.correlation.clientId,
                p_work_item_id: input.correlation.workItemId,
                p_step_id: input.stepId,
                p_attempt_id: input.attemptId,
                p_error_code: input.errorCode,
              },
            );
            if (error || !data) {
              throw new LedgerGenerationError("attempt_settlement_failed", 503);
            }
          },
        });
        if (prepared.replay) {
          const replay = await loadPersistedCalOptimaDraftPacket(user.id, resolved.payload);
          return json(
            req,
            await verifyLedgerReplayPacket(
              replay.packet,
              replay.outputHash,
              replay.packetHash,
              prepared.replayOutputHash,
            ),
            200,
          );
        }
        payload = prepared.payload;
        ledgerResultContext = {
          correlation: resolved.payload,
          actorUserId: user.id,
          stepId: prepared.stepId,
          attemptId: prepared.attemptId,
          payload,
        };
      } else {
        const legacyAssessment = await dependencies.lookupLegacyAssessment(db, {
          assessmentDocumentId: resolved.payload.assessment_document_id,
          organizationId: resolved.payload.organization_id,
          clientId: resolved.payload.client_id,
        });
        if (!legacyAssessment) {
          return json(req, { error: "Legacy-bound draft generation denied", code: "generation_scope_denied" }, 403);
        }
        payload = resolved.payload;
      }

      const completion = normalizeCompletionResult(
        await dependencies.invokeCompletion(
          payload,
          ledgerBound,
          ledgerBound
            ? (inputTokens, outputTokens) => {
              ledgerInputTokens = inputTokens;
              ledgerOutputTokens = outputTokens;
            }
            : undefined,
        ),
      );

      if (ledgerResultContext) {
        await dependencies.requireLedgerAdvisoryRuntime();
        ledgerInputTokens = completion.inputTokens;
        ledgerOutputTokens = completion.outputTokens;
        await recordLedgerModelResult(
          ledgerResultContext,
          completion.response,
          ledgerInputTokens,
          ledgerOutputTokens,
          completion.errorClass,
          completion.errorCode,
        );
        ledgerResultRecorded = true;
      }

      return json(req, completion.response, 200);
    } catch (error) {
      if (ledgerResultContext && !ledgerResultRecorded) {
        try {
          await dependencies.requireLedgerAdvisoryRuntime();
          const fallback = buildFallbackResponse(ledgerResultContext.payload, "upstream_unavailable");
          await recordLedgerModelResult(
            ledgerResultContext,
            fallback,
            ledgerInputTokens,
            ledgerOutputTokens,
            "provider",
            "upstream_unavailable",
          );
          ledgerResultRecorded = true;
          return json(req, fallback, 200);
        } catch {
          // The original fail-closed error remains authoritative when finalization also fails.
        }
      }
      if (error instanceof LedgerGenerationError || error instanceof LedgerPreparationError) {
        console.error("generate-program-goals ledger error", error.code);
        return json(req, { error: "Ledger-bound draft generation denied", code: error.code }, error.status);
      }
      if (!ledgerResultContext && error instanceof Error && error.name === "GenerationAttemptsExhaustedError") {
        return json(req, { error: error.message }, 502);
      }
      console.error("generate-program-goals error", error instanceof Error ? error.name : "unknown");
      return json(req, { error: "Failed to generate draft" }, 500);
    }
  };
}

export const handleGenerateProgramGoals = createGenerateProgramGoalsHandler();

export const __TESTING__ = {
  buildUserPrompt,
  parseAndValidateCandidate,
  resolveGenerationRequest,
  hasWeakEvidenceWithoutFlags,
  countGoalsByType,
  buildFallbackResponse,
  deriveStableLedgerRequestId,
  selectStructuredEvidenceContent,
  findDuplicateGoalTitles,
  requestSchema,
  responseSchema,
  REVIEW_FLAGS,
  ledgerGenerationSchema,
  prepareLedgerGeneration,
  buildCompletionRequest,
  verifyLedgerReplayPacket,
};

if (import.meta.main) {
  Deno.serve(handleGenerateProgramGoals);
}
