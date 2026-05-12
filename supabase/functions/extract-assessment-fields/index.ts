import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { z } from "npm:zod@3.23.8";
import { Buffer } from "node:buffer";
import { resolveAllowedOrigin } from "../_shared/cors.ts";

const corsHeaders = (req: Request) => ({
  "Access-Control-Allow-Origin": resolveAllowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-request-id, x-correlation-id",
  Vary: "Origin",
});

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

interface StructuredSectionResult {
  section_key: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
  source_span: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved";
  required: boolean;
  review_notes: string | null;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const json = (req: Request, payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });

const stripXmlTags = (xml: string): string =>
  xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
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

const decodePdfText = async (bytes: Uint8Array): Promise<string> => {
  try {
    const parsePdfModule = await import("npm:pdf-parse@1.1.1");
    const parsePdf = parsePdfModule.default as (value: Buffer) => Promise<{ text?: string }>;
    const parsed = await parsePdf(Buffer.from(bytes));
    const text = typeof parsed?.text === "string" ? parsed.text : "";
    const normalized = normalizeText(text);
    if (normalized.length >= 80) {
      return normalized;
    }
  } catch {
    // Fall through to legacy fallback.
  }
  return decodePdfFallbackText(bytes);
};

const summarizeTextQuality = (text: string): "high" | "medium" | "low" => {
  if (!text || text.length < 80) {
    return "low";
  }
  const alphaMatches = text.match(/[A-Za-z]/g) ?? [];
  const alphaRatio = alphaMatches.length / text.length;
  if (alphaRatio < 0.25) {
    return "low";
  }
  if (alphaRatio < 0.45) {
    return "medium";
  }
  return "high";
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

const parseKeyValueSegments = (value: string): Record<string, string> => {
  const payload: Record<string, string> = {};
  value.split("|").forEach((segment) => {
    const match = segment.match(/^\s*([^:]+)\s*:\s*(.+?)\s*$/);
    if (!match?.[1] || !match?.[2]) {
      return;
    }
    payload[match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")] = match[2].trim();
  });
  return payload;
};

const extractStructuredGoalSections = (text: string): StructuredSectionResult[] => {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sections: StructuredSectionResult[] = [];
  let current: {
    field_key: string;
    section_key: string;
    payload: Record<string, unknown>;
    start_line: number;
  } | null = null;

  const flush = (endLine: number) => {
    if (!current) {
      return;
    }
    sections.push({
      section_key: current.section_key,
      field_key: current.field_key,
      section_index: sections.filter((section) => section.field_key === current?.field_key).length,
      payload: current.payload,
      source_span: { method: "deterministic_goal_block", start_line: current.start_line, end_line: endLine },
      status: "drafted",
      required: true,
      review_notes: "Deterministic structured goal block extracted from CalOptima document text.",
    });
    current = null;
  };

  lines.forEach((line, index) => {
    const goalMatch = line.match(/^(child|parent|target\/replacement|target|replacement|skill acquisition|caregiver)\s+goal\s*\d*\s*[:-]\s*(.+)$/i);
    if (goalMatch?.[1] && goalMatch?.[2]) {
      flush(index);
      const label = goalMatch[1].toLowerCase();
      const isParent = label.includes("parent") || label.includes("caregiver");
      const isSkill = label.includes("skill");
      current = {
        field_key: isParent
          ? "CALOPTIMA_FBA_PARENT_GOALS"
          : isSkill
            ? "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS"
            : "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
        section_key: "goals_treatment_planning",
        start_line: index + 1,
        payload: {
          title: goalMatch[2].trim(),
          goal_type: isParent ? "parent" : "child",
          program_name: isParent ? "Parent Training" : "Behavior Treatment",
          original_text: line,
        },
      };
      return;
    }
    if (!current) {
      return;
    }
    const fieldMatch = line.match(/^(program|description|target behavior|behavior|skill|measurement type|measure|baseline|target criteria|criteria|mastery criteria|maintenance criteria|generalization criteria|rationale|objective data points?)\s*[:-]\s*(.+)$/i);
    if (!fieldMatch?.[1] || !fieldMatch?.[2]) {
      current.payload.original_text = `${String(current.payload.original_text ?? "")}\n${line}`.trim();
      return;
    }
    const key = fieldMatch[1].toLowerCase().replace(/\s+/g, "_").replace(/^measure$/, "measurement_type");
    const value = fieldMatch[2].trim();
    if (key.startsWith("objective_data_point")) {
      const currentRows = Array.isArray(current.payload.objective_data_points)
        ? current.payload.objective_data_points as Record<string, unknown>[]
        : [];
      current.payload.objective_data_points = [...currentRows, { ...parseKeyValueSegments(value), raw_text: value }];
      return;
    }
    current.payload[key === "behavior" || key === "skill" ? "target_behavior" : key] = value;
  });
  flush(lines.length);
  return sections;
};

const extractStructuredTableSections = (text: string): StructuredSectionResult[] => {
  const tableSpecs = [
    { field_key: "CALOPTIMA_FBA_RECORDS_REVIEWED", section_key: "records_reviewed", prefix: /^record reviewed\s*[:-]\s*(.+)$/i },
    { field_key: "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES", section_key: "assessment_results", prefix: /^vineland domain\s*[:-]\s*(.+)$/i },
    { field_key: "CALOPTIMA_FBA_HCPCS_RECOMMENDATIONS", section_key: "service_recommendations", prefix: /^hcpcs\s*[:-]\s*(.+)$/i },
    { field_key: "CALOPTIMA_FBA_DAILY_SCHEDULES", section_key: "daily_schedules", prefix: /^daily schedule\s*[:-]\s*(.+)$/i },
  ];
  const rowsByKey = new Map<string, Record<string, unknown>[]>();
  text.split(/\n+/).forEach((line) => {
    const trimmed = line.trim();
    for (const spec of tableSpecs) {
      const match = trimmed.match(spec.prefix);
      if (!match?.[1]) {
        continue;
      }
      const existing = rowsByKey.get(spec.field_key) ?? [];
      rowsByKey.set(spec.field_key, [...existing, { ...parseKeyValueSegments(match[1]), raw_text: match[1].trim() }]);
    }
  });
  return tableSpecs.flatMap((spec) => {
    const rows = rowsByKey.get(spec.field_key) ?? [];
    if (rows.length === 0) {
      return [];
    }
    return [{
      section_key: spec.section_key,
      field_key: spec.field_key,
      section_index: 0,
      payload: { rows },
      source_span: { method: "deterministic_table_lines", row_count: rows.length },
      status: "drafted" as const,
      required: true,
      review_notes: "Deterministic structured table rows extracted from CalOptima document text.",
    }];
  });
};

const extractStructuredSections = (text: string): StructuredSectionResult[] => [
  ...extractStructuredGoalSections(text),
  ...extractStructuredTableSections(text),
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(req, { error: "Supabase environment configuration is missing." }, 500);
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    const requestClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await requestClient.auth.getUser();
    if (userError || !userData?.user) {
      return json(req, { error: "Unauthorized" }, 401);
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return json(req, { error: "Invalid request body" }, 400);
    }

    const { data } = parsed;
    const { data: scopedAssessment, error: scopedAssessmentError } = await requestClient
      .from("assessment_documents")
      .select("id, client_id, organization_id, bucket_id, object_path")
      .eq("id", data.assessment_document_id)
      .maybeSingle();

    if (scopedAssessmentError || !scopedAssessment) {
      return json(req, { error: "Assessment document is not accessible for this user context." }, 403);
    }

    if (scopedAssessment.bucket_id !== data.bucket_id || scopedAssessment.object_path !== data.object_path) {
      return json(req, { error: "Assessment document storage location mismatch." }, 403);
    }

    const expectedClientPrefix = `clients/${scopedAssessment.client_id}/`;
    if (!data.object_path.startsWith(expectedClientPrefix)) {
      return json(req, { error: "Assessment document path is outside the allowed client scope." }, 403);
    }

    const download = await adminClient.storage.from(data.bucket_id).download(data.object_path);
    if (download.error || !download.data) {
      return json(req, { error: "Unable to download uploaded assessment document." }, 502);
    }

    const objectPathLower = data.object_path.toLowerCase();
    if (!objectPathLower.endsWith(".pdf") && !objectPathLower.endsWith(".docx")) {
      return json(req, { error: "Unsupported assessment document type." }, 415);
    }

    if (download.data.size > MAX_DOCUMENT_BYTES) {
      return json(req, { error: "Assessment document exceeds maximum supported size." }, 413);
    }

    const fileBytes = new Uint8Array(await download.data.arrayBuffer());
    const documentText = objectPathLower.endsWith(".docx")
      ? await decodeDocxText(fileBytes)
      : await decodePdfText(fileBytes);
    const textQuality = summarizeTextQuality(documentText);

    const deterministic = data.checklist_rows.map((row) => deterministicValueForRow(row, documentText, data.client_snapshot));
    const structuredSections = extractStructuredSections(documentText);
    const structuredSummaryByKey = new Map<string, { count: number; firstPayload: Record<string, unknown> }>();
    structuredSections.forEach((section) => {
      const current = structuredSummaryByKey.get(section.field_key);
      structuredSummaryByKey.set(section.field_key, {
        count: (current?.count ?? 0) + 1,
        firstPayload: current?.firstPayload ?? section.payload,
      });
    });
    const merged = deterministic.map((field) => {
      const structuredSummary = structuredSummaryByKey.get(field.placeholder_key);
      if (!structuredSummary) {
        return field;
      }
      return {
        ...field,
        value_text: `${structuredSummary.count} structured section${structuredSummary.count === 1 ? "" : "s"} extracted`,
        value_json: structuredSummary.firstPayload,
        confidence: 0.9,
        mode: "AUTO" as const,
        status: "drafted" as const,
        source_span: { method: "deterministic_structured_section_summary" },
        review_notes: "Deterministic structured extraction summary. Review full structured section payloads before approval.",
      };
    });

    return json(req, {
      assessment_document_id: data.assessment_document_id,
      template_type: data.template_type,
      fields: merged,
      structured_sections: structuredSections,
      unresolved_keys: merged.filter((field) => !field.value_text).map((field) => field.placeholder_key),
      extracted_count: merged.filter((field) => field.value_text).length,
      unresolved_count: merged.filter((field) => !field.value_text).length,
      text_char_count: documentText.length,
      text_quality: textQuality,
    });
  } catch (error) {
    console.error("extract-assessment-fields error", error);
    return json(req, { error: "Failed to extract assessment fields." }, 500);
  }
});
