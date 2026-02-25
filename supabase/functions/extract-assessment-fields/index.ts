import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { OpenAI } from "npm:openai@5.5.1";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-request-id, x-correlation-id",
};

const checklistRowSchema = z.object({
  section: z.string().min(1),
  label: z.string().min(1),
  placeholder_key: z.string().min(1),
  required: z.boolean(),
});

const requestSchema = z.object({
  assessment_document_id: z.string().uuid(),
  template_type: z.literal("caloptima_fba"),
  bucket_id: z.string().min(1),
  object_path: z.string().min(1),
  checklist_rows: z.array(checklistRowSchema).min(1),
  client_snapshot: z
    .object({
      full_name: z.string().nullish(),
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      date_of_birth: z.string().nullish(),
      cin_number: z.string().nullish(),
      client_id: z.string().nullish(),
      phone: z.string().nullish(),
      parent1_phone: z.string().nullish(),
      parent1_first_name: z.string().nullish(),
      parent1_last_name: z.string().nullish(),
    })
    .optional(),
});

const aiFieldSchema = z.object({
  placeholder_key: z.string().min(1),
  value_text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const aiResponseSchema = z.object({
  fields: z.array(aiFieldSchema),
});

const structuredRecommendationJsonSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  target_behavior: z.string().min(1).max(500).optional(),
  measurement_type: z.string().min(1).max(120).optional(),
  baseline_data: z.string().min(1).max(700).optional(),
  target_criteria: z.string().min(1).max(700).optional(),
  mastery_criteria: z.string().min(1).max(700).optional(),
  maintenance_criteria: z.string().min(1).max(700).optional(),
  generalization_criteria: z.string().min(1).max(700).optional(),
  data_settings: z.record(z.unknown()).optional(),
  objective_data_points: z.array(z.record(z.unknown())).optional(),
});

const structuredAiFieldSchema = z.object({
  placeholder_key: z.string().min(1),
  value_text: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  value_json: structuredRecommendationJsonSchema.optional(),
});

const structuredAiResponseSchema = z.object({
  fields: z.array(structuredAiFieldSchema),
});

interface ExtractedFieldResult {
  placeholder_key: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  confidence: number | null;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  status: "not_started" | "drafted";
  source_span: Record<string, unknown> | null;
  review_notes: string | null;
}

const STRUCTURED_RECOMMENDATION_KEYS = new Set<string>([
  "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
  "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
  "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
  "CALOPTIMA_FBA_PARENT_GOALS",
  "CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN",
  "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
  "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
]);

const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const stripXmlTags = (xml: string): string =>
  xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const normalizeText = (value: string): string =>
  value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const decodeDocxText = async (bytes: Uint8Array): Promise<string> => {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    return "";
  }
  return normalizeText(stripXmlTags(documentXml));
};

const decodePdfFallbackText = (bytes: Uint8Array): string => {
  const decoded = new TextDecoder("latin1").decode(bytes);
  return normalizeText(decoded.replace(/[^\x20-\x7E\n]/g, " "));
};

const extractLineNearLabel = (text: string, label: string): string | null => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*([^\\n]{2,180})`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  const value = match[1].trim();
  return value.length > 0 ? value : null;
};

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0.0;
  }
  return Math.min(0.99, Math.max(0.0, value));
};

const normalizeForContains = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const calibrateDeterministicConfidence = (rowLabel: string, valueText: string, text: string): number => {
  const normalizedText = normalizeForContains(text);
  const normalizedValue = normalizeForContains(valueText);
  const normalizedLabel = normalizeForContains(rowLabel);
  const hasValueInText = normalizedValue.length >= 3 && normalizedText.includes(normalizedValue);
  const hasLabelInText = normalizedLabel.length >= 3 && normalizedText.includes(normalizedLabel);

  let confidence = 0.88;
  if (hasValueInText) {
    confidence += 0.05;
  }
  if (hasLabelInText) {
    confidence += 0.03;
  }
  return clampConfidence(confidence);
};

const calibrateAiConfidence = (args: {
  providedConfidence?: number;
  rowLabel: string;
  valueText: string;
  documentText: string;
}): number => {
  const { providedConfidence, rowLabel, valueText, documentText } = args;
  const normalizedText = normalizeForContains(documentText);
  const normalizedValue = normalizeForContains(valueText);
  const normalizedLabel = normalizeForContains(rowLabel);
  const hasValueInText = normalizedValue.length >= 3 && normalizedText.includes(normalizedValue);
  const hasLabelInText = normalizedLabel.length >= 3 && normalizedText.includes(normalizedLabel);
  const nearLabelRegex = new RegExp(
    `${rowLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-]?\\s*${valueText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );
  const hasNearLabelEvidence = nearLabelRegex.test(documentText);

  let confidence = typeof providedConfidence === "number" ? providedConfidence : 0.78;
  if (hasValueInText) {
    confidence += 0.10;
  }
  if (hasLabelInText) {
    confidence += 0.04;
  }
  if (hasNearLabelEvidence) {
    confidence += 0.06;
  }
  return clampConfidence(confidence);
};

const deterministicValueForRow = (
  row: z.infer<typeof checklistRowSchema>,
  text: string,
  clientSnapshot?: z.infer<typeof requestSchema.shape.client_snapshot>,
): ExtractedFieldResult => {
  const key = row.placeholder_key;
  const fromLabel = extractLineNearLabel(text, row.label);
  if (fromLabel) {
    const confidence = calibrateDeterministicConfidence(row.label, fromLabel, text);
    return {
      placeholder_key: key,
      value_text: fromLabel,
      value_json: null,
      confidence,
      mode: "AUTO",
      status: "drafted",
      source_span: { method: "label_regex", label: row.label },
      review_notes: `Deterministic extraction from document label match. (Calibrated confidence ${confidence.toFixed(2)})`,
    };
  }

  const client = clientSnapshot ?? {};
  if (/MEMBER_NAME|CLIENT_NAME/u.test(key) && client.full_name) {
    return {
      placeholder_key: key,
      value_text: client.full_name,
      value_json: null,
      confidence: 0.98,
      mode: "AUTO",
      status: "drafted",
      source_span: { method: "client_snapshot", field: "full_name" },
      review_notes: "Auto-filled from client snapshot.",
    };
  }
  if (/DOB|DATE_OF_BIRTH/u.test(key) && client.date_of_birth) {
    return {
      placeholder_key: key,
      value_text: client.date_of_birth,
      value_json: null,
      confidence: 0.98,
      mode: "AUTO",
      status: "drafted",
      source_span: { method: "client_snapshot", field: "date_of_birth" },
      review_notes: "Auto-filled from client snapshot.",
    };
  }
  if (/MEMBER_ID|CIN/u.test(key) && (client.cin_number || client.client_id)) {
    return {
      placeholder_key: key,
      value_text: client.cin_number ?? client.client_id ?? null,
      value_json: null,
      confidence: 0.95,
      mode: "AUTO",
      status: "drafted",
      source_span: { method: "client_snapshot", field: client.cin_number ? "cin_number" : "client_id" },
      review_notes: "Auto-filled from client snapshot.",
    };
  }
  return {
    placeholder_key: key,
    value_text: null,
    value_json: null,
    confidence: null,
    mode: "MANUAL",
    status: "not_started",
    source_span: null,
    review_notes: null,
  };
};

const resolveAiAssistedFields = async (
  unresolvedRows: z.infer<typeof checklistRowSchema>[],
  documentText: string,
): Promise<ExtractedFieldResult[]> => {
  if (!openai || unresolvedRows.length === 0 || documentText.trim().length < 20) {
    return [];
  }

  const prompt = `
Extract values for unresolved CalOptima FBA fields from this document text.
Return strict JSON only:
{"fields":[{"placeholder_key":"...","value_text":"...","confidence":0.0}]}

Rules:
- Only include keys you can infer with moderate confidence.
- Omit unknown values.
- Keep value_text concise and literal.

Unresolved rows:
${JSON.stringify(unresolvedRows)}

Document text:
${documentText.slice(0, 12000)}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 1200,
    messages: [
      { role: "system", content: "You extract structured fields and return strict JSON only." },
      { role: "user", content: prompt },
    ],
  });
  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
  } catch {
    return [];
  }
  const validated = aiResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return [];
  }

  const rowByKey = new Map(unresolvedRows.map((row) => [row.placeholder_key, row]));
  return validated.data.fields.map((field) => {
    const row = rowByKey.get(field.placeholder_key);
    const calibratedConfidence = calibrateAiConfidence({
      providedConfidence: field.confidence,
      rowLabel: row?.label ?? field.placeholder_key,
      valueText: field.value_text,
      documentText,
    });
    return {
      placeholder_key: field.placeholder_key,
      value_text: field.value_text,
      value_json: null,
      confidence: calibratedConfidence,
      mode: "ASSISTED",
      status: "drafted",
      source_span: { method: "ai_assist" },
      review_notes: `AI-assisted extraction for unresolved field. (Calibrated confidence ${calibratedConfidence.toFixed(2)})`,
    };
  });
};

const summarizeStructuredRecommendation = (valueJson: z.infer<typeof structuredRecommendationJsonSchema> | undefined): string | null => {
  if (!valueJson) {
    return null;
  }
  const parts = [
    valueJson.title,
    valueJson.target_behavior,
    valueJson.measurement_type,
    valueJson.baseline_data,
    valueJson.target_criteria,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" | ").slice(0, 700);
};

const resolveStructuredRecommendationFields = async (
  rows: z.infer<typeof checklistRowSchema>[],
  documentText: string,
): Promise<ExtractedFieldResult[]> => {
  if (!openai || documentText.trim().length < 20) {
    return [];
  }
  const structuredRows = rows.filter((row) => STRUCTURED_RECOMMENDATION_KEYS.has(row.placeholder_key));
  if (structuredRows.length === 0) {
    return [];
  }

  const prompt = `
Extract structured ABA recommendation data from this assessment text.
Return strict JSON only with this shape:
{
  "fields": [
    {
      "placeholder_key": "string",
      "value_text": "short summary",
      "confidence": 0.0,
      "value_json": {
        "title": "string",
        "target_behavior": "string",
        "measurement_type": "string",
        "baseline_data": "string",
        "target_criteria": "string",
        "mastery_criteria": "string",
        "maintenance_criteria": "string",
        "generalization_criteria": "string",
        "data_settings": {},
        "objective_data_points": []
      }
    }
  ]
}

Rules:
- Include only fields with moderate confidence or better.
- Keep values literal and concise from source text when possible.
- If a value is not present, omit it rather than inventing.
- objective_data_points should be an array of objects when objective-level rows are present.

Rows to extract:
${JSON.stringify(structuredRows)}

Document text:
${documentText.slice(0, 12000)}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 1400,
    messages: [
      { role: "system", content: "You extract structured ABA recommendation data and return strict JSON only." },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
  } catch {
    return [];
  }

  const validated = structuredAiResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return [];
  }

  const rowByKey = new Map(structuredRows.map((row) => [row.placeholder_key, row]));
  return validated.data.fields.map((field) => {
    const row = rowByKey.get(field.placeholder_key);
    const summary = field.value_text ?? summarizeStructuredRecommendation(field.value_json) ?? "Structured recommendation extracted";
    const calibratedConfidence = calibrateAiConfidence({
      providedConfidence: field.confidence,
      rowLabel: row?.label ?? field.placeholder_key,
      valueText: summary,
      documentText,
    });

    return {
      placeholder_key: field.placeholder_key,
      value_text: summary,
      value_json: field.value_json ? { ...field.value_json } : null,
      confidence: calibratedConfidence,
      mode: "ASSISTED",
      status: "drafted",
      source_span: { method: "ai_structured_recommendation" },
      review_notes: `AI-assisted structured recommendation extraction. (Calibrated confidence ${calibratedConfidence.toFixed(2)})`,
    };
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase environment configuration is missing." }, 500);
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    const requestClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await requestClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const { data } = parsed;
    const download = await adminClient.storage.from(data.bucket_id).download(data.object_path);
    if (download.error || !download.data) {
      return json({ error: "Unable to download uploaded assessment document." }, 502);
    }

    const fileBytes = new Uint8Array(await download.data.arrayBuffer());
    const objectPathLower = data.object_path.toLowerCase();
    const documentText = objectPathLower.endsWith(".docx")
      ? await decodeDocxText(fileBytes)
      : decodePdfFallbackText(fileBytes);

    const deterministic = data.checklist_rows.map((row) => deterministicValueForRow(row, documentText, data.client_snapshot));
    const unresolvedRows = data.checklist_rows.filter(
      (row) => !deterministic.find((field) => field.placeholder_key === row.placeholder_key && field.value_text),
    );

    const [aiAssisted, structuredRecommendations] = await Promise.all([
      resolveAiAssistedFields(unresolvedRows, documentText),
      resolveStructuredRecommendationFields(data.checklist_rows, documentText),
    ]);
    const aiByKey = new Map(aiAssisted.map((field) => [field.placeholder_key, field]));
    const structuredByKey = new Map(structuredRecommendations.map((field) => [field.placeholder_key, field]));
    const merged = deterministic.map(
      (field) => structuredByKey.get(field.placeholder_key) ?? aiByKey.get(field.placeholder_key) ?? field,
    );

    return json({
      assessment_document_id: data.assessment_document_id,
      template_type: data.template_type,
      fields: merged,
      unresolved_keys: merged.filter((field) => !field.value_text).map((field) => field.placeholder_key),
      extracted_count: merged.filter((field) => field.value_text).length,
      unresolved_count: merged.filter((field) => !field.value_text).length,
      text_char_count: documentText.length,
    });
  } catch (error) {
    console.error("extract-assessment-fields error", error);
    return json({ error: "Failed to extract assessment fields." }, 500);
  }
});
