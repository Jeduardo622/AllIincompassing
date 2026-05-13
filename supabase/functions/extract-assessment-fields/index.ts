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
  extraction_aliases: z.array(z.string().min(1)).optional(),
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

const extractLineNearLabel = (text: string, label: string, stopLabels: string[] = []): string | null => {
  const pattern = new RegExp(`${flexibleLabelPattern(label)}\\s*[:\\-]?\\s*([^\\n]{2,260})`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return trimAtInlineBoundary(match[1], stopLabels);
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

const compactForContains = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const flexibleLabelPattern = (label: string): string => escapeRegExp(label.trim()).replace(/\s+/g, "\\s+");

const normalizeInlineText = (value: string): string =>
  value
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();

const compactDocumentText = (text: string): string => normalizeInlineText(text).replace(/\s+/g, " ").trim();

const normalizeExtractedValue = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\s:|-]+/g, "")
    .replace(/[\s|,;:.-]+$/g, "")
    .trim();

const CALOPTIMA_INLINE_STOP_LABELS = [
  "Member Name",
  "Member DOB",
  "CIN #",
  "Diagnoses/with ICD Code",
  "Guardian Name",
  "Phone",
  "Primary Care Provider",
  "Known Allergies",
  "Current Medications/Dosage",
  "Dietary Restrictions",
  "LMHP",
  "Contact Number",
  "Service Initiation Date",
  "Date ABA first began",
  "Prior Applied Behavioral Health Agencies",
  "Full Name and Title",
  "Phone Number",
  "Fax Number",
  "Chief Complaint/Reason for Seeking Applied Behavior Analysis (ABA) Treatment",
  "Chief Complaint/Reason for Seeking ABA Treatment",
  "Records Reviewed",
  "Interviews Conducted",
  "Daily School Schedule",
  "Date of the current IEP/equivalent",
  "Individualized Educational Plan (IEP/equivalent) Information",
  "Title, License/Certificate #",
  "Date of Report Completed",
];

const CALOPTIMA_SECTION_STOP_PATTERNS = [
  /\b[IVX]{1,6}\.\s+[A-Z][A-Z /-]{3,}/i,
  /\b\d+\.\s+(?:Are|Does|If|Date|Did|Was|Is)\b/i,
];

const collectStopLabels = (
  currentLabels: string[],
  allRows?: Array<z.infer<typeof checklistRowSchema>>,
): string[] => {
  const current = new Set(currentLabels.map((label) => normalizeForContains(label)));
  const labels = new Set(CALOPTIMA_INLINE_STOP_LABELS);
  for (const row of allRows ?? []) {
    [row.label, ...(row.extraction_aliases ?? [])].forEach((label) => {
      const normalized = normalizeForContains(label);
      if (normalized.length >= 3 && !current.has(normalized)) {
        labels.add(label);
      }
    });
  }
  return [...labels].filter((label) => !current.has(normalizeForContains(label)));
};

const trimAtInlineBoundary = (value: string, stopLabels: string[]): string | null => {
  let earliest = value.length;
  for (const label of stopLabels) {
    if (label.trim().length < 3) {
      continue;
    }
    const match = value.match(new RegExp(`(?:^|\\s)${flexibleLabelPattern(label)}\\s*[:\\-]?`, "i"));
    if (match?.index !== undefined && match.index >= 0) {
      earliest = Math.min(earliest, match.index);
    }
  }
  for (const pattern of CALOPTIMA_SECTION_STOP_PATTERNS) {
    const match = value.match(pattern);
    if (match?.index !== undefined && match.index >= 0) {
      earliest = Math.min(earliest, match.index);
    }
  }
  const trimmed = normalizeExtractedValue(value.slice(0, earliest));
  return trimmed.length > 0 ? trimmed : null;
};

const findAnchor = (text: string, anchors: RegExp[]): RegExpMatchArray | null => {
  for (const anchor of anchors) {
    const match = text.match(anchor);
    if (match) {
      return match;
    }
  }
  return null;
};

const extractSectionText = (text: string, startAnchors: RegExp[], endAnchors: RegExp[]): string | null => {
  const normalized = compactDocumentText(text);
  const start = findAnchor(normalized, startAnchors);
  if (!start || start.index === undefined) {
    return null;
  }
  const startIndex = start.index;
  const afterStart = normalized.slice(startIndex);
  let endIndex = afterStart.length;
  for (const endAnchor of endAnchors) {
    const match = afterStart.match(endAnchor);
    if (match?.index !== undefined && match.index > 0) {
      endIndex = Math.min(endIndex, match.index);
    }
  }
  const sectionText = afterStart.slice(0, endIndex).trim();
  return sectionText.length >= 20 ? sectionText : null;
};

const makeAutoField = (
  row: z.infer<typeof checklistRowSchema>,
  valueText: string,
  sourceSpan: Record<string, unknown>,
  text: string,
): ExtractedFieldResult => {
  const confidence = calibrateDeterministicConfidence(row.label, valueText, text);
  return {
    placeholder_key: row.placeholder_key,
    value_text: valueText,
    value_json: null,
    confidence,
    mode: "AUTO",
    status: "drafted",
    source_span: sourceSpan,
    review_notes: `Deterministic extraction from document text. (Calibrated confidence ${confidence.toFixed(2)})`,
  };
};

const extractSelectedYesNo = (afterQuestion: string): "Yes" | "No" | null => {
  const normalized = afterQuestion.replace(/\s+/g, " ");
  const markerPattern = "(☒|â˜’|þ|\\[x\\]|x|☐|â˜|□|\\[\\s\\])";
  const pair = normalized.match(new RegExp(`${markerPattern}\\s*Yes\\s+${markerPattern}\\s*No`, "i"));
  const isSelected = (marker: string): boolean => /^(?:☒|â˜’|þ|\[x\]|x)$/i.test(marker.trim());
  if (pair?.[1] && pair?.[2]) {
    if (isSelected(pair[1]) && !isSelected(pair[2])) {
      return "Yes";
    }
    if (!isSelected(pair[1]) && isSelected(pair[2])) {
      return "No";
    }
  }
  const noOnly = normalized.match(new RegExp(`Yes\\s+${markerPattern}\\s*No`, "i"));
  if (noOnly?.[1]) {
    return isSelected(noOnly[1]) ? "No" : "Yes";
  }
  return null;
};

const extractCheckboxScalarByKey = (key: string, text: string): string | null => {
  const compact = compactDocumentText(text);
  const questionSpecs = [
    {
      key: "CALOPTIMA_FBA_HAS_IEP",
      question: /Does\s+the\s+member\s+have\s+a\s+current\s+Individualized\s+Educational\s+Plan\s+\(IEP\/equivalent\)\?/i,
      end: /If\s+No,\s+please\s+explain|3\.\s+If\s+yes/i,
    },
    {
      key: "CALOPTIMA_FBA_PARENT_INVOLVEMENT",
      question: /Was\s+the\s+Parent\/guardian\s+involved\s+in\s+the\s+development\s+of\s+the\s+treatment\s+plan\?/i,
      end: /If\s+No\s+to\s+any\s+response|XVIII\.\s+SIGNATURES/i,
      followUpQuestion: /Is\s+the\s+parent\/guardian\s+in\s+agreement\s+with\s+the\s+submitted\s+treatment\s+plan\?/i,
    },
    {
      key: "CALOPTIMA_FBA_TELEHEALTH_CONSENT",
      question: /Telehealth\s+Consent\s+Confirmation/i,
      end: /XXI\.\s+PARENT\/CAREGIVER|XVIII\.\s+SIGNATURES/i,
    },
  ] as const;
  const spec = questionSpecs.find((candidate) => candidate.key === key);
  if (!spec) {
    return null;
  }
  const questionMatch = compact.match(spec.question);
  if (!questionMatch || questionMatch.index === undefined) {
    return null;
  }
  const afterQuestion = compact.slice(questionMatch.index + questionMatch[0].length);
  const endMatch = afterQuestion.match(spec.end);
  const bounded = afterQuestion.slice(0, endMatch?.index ?? Math.min(afterQuestion.length, 600));
  const primary = extractSelectedYesNo(bounded);
  if (!primary) {
    return null;
  }
  if (!("followUpQuestion" in spec)) {
    return primary;
  }
  const followUpMatch = bounded.match(spec.followUpQuestion);
  if (!followUpMatch || followUpMatch.index === undefined) {
    return `development: ${primary}`;
  }
  const secondary = extractSelectedYesNo(bounded.slice(followUpMatch.index + followUpMatch[0].length));
  return secondary ? `development: ${primary}; agreement: ${secondary}` : `development: ${primary}`;
};

const extractScalarSectionByKey = (key: string, text: string): string | null => {
  const specs: Record<string, { start: RegExp[]; end: RegExp[] }> = {
    CALOPTIMA_FBA_CHIEF_COMPLAINT: {
      start: [/Chief\s+Complaint\/Reason\s+for\s+Seeking\s+Applied\s+Behavior\s+Analysis\s+\(ABA\)\s+Treatment:?\s*/i],
      end: [/II\.\s+DATA\s+SOURCES/i, /Records\s+Reviewed/i],
    },
    CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN: {
      start: [
        /XVII\.\s+PLAN\s+FOR\s+GENERALIZATION\s+\(INCLUDING\s+TRANSITION\s+TO\s+NATURAL\s+MEDIATORS\)\s+AND\s+MAINTENANCE/i,
        /PLAN\s+FOR\s+GENERALIZATION\s+\(INCLUDING\s+TRANSITION\s+TO\s+NATURAL\s+MEDIATORS\)\s+AND\s+MAINTENANCE/i,
        /PLAN\s+FOR\s+GENERALIZATION/i,
      ],
      end: [/XVIII\.\s+CRISIS\s+PLAN/i, /CRISIS\s+PLAN/i, /XX\.\s+SERVICE\s+RECOMMENDATIONS/i],
    },
    CALOPTIMA_FBA_TRANSITION_PLAN: {
      start: [/XIII\.\s+TRANSITION\s+PLAN/i, /\bTRANSITION\s+PLAN\s+AND\s+EXIT\s+CRITERIA\b/i],
      end: [/XIV\.\s+/i, /CRISIS\s+PLAN/i, /SERVICE\s+RECOMMENDATIONS/i],
    },
  };
  const spec = specs[key];
  if (!spec) {
    return null;
  }
  const sectionText = extractSectionText(text, spec.start, spec.end);
  if (!sectionText) {
    return null;
  }
  const withoutHeading = spec.start.reduce((current, pattern) => current.replace(pattern, ""), sectionText);
  const cleaned = normalizeExtractedValue(withoutHeading);
  return cleaned.length >= 10 ? cleaned : null;
};

const extractSignatureScalarByKey = (key: string, text: string): string | null => {
  const sectionText = extractSectionText(
    text,
    [/XVIII\.\s+SIGNATURES/i],
    [/\*\*\s+By\s+signing/i],
  );
  if (!sectionText) {
    return null;
  }
  const compact = compactDocumentText(sectionText);
  if (key === "CALOPTIMA_FBA_REPORT_COMPLETED_DATE") {
    const match = compact.match(/Date\s+of\s+Report\s+Completed\s*:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i);
    return match?.[1] ? normalizeExtractedValue(match[1]) : null;
  }
  if (key === "CALOPTIMA_FBA_REPORT_WRITTEN_BY") {
    const match = compact.match(/Report\s+written\s+by:\s*(?:\([^)]*\)\s*)?(?:(?:BCa?BA\/BMA\s+or\s+)?BCBA\/BMC\s+professional\s+level\s*)?(.+?)(?=Title,\s+License\/Certificate|Date\s+of\s+Report\s+Completed|Signature:)/i);
    return match?.[1] ? normalizeExtractedValue(match[1]) : null;
  }
  return null;
};

const extractSpecialScalarByKey = (
  row: z.infer<typeof checklistRowSchema>,
  text: string,
): ExtractedFieldResult | null => {
  const key = row.placeholder_key;
  const checkbox = extractCheckboxScalarByKey(key, text);
  if (checkbox) {
    return makeAutoField(row, checkbox, { method: "checkbox_yes_no", key }, text);
  }
  const signature = extractSignatureScalarByKey(key, text);
  if (signature) {
    return makeAutoField(row, signature, { method: "signature_section", key }, text);
  }
  const section = extractScalarSectionByKey(key, text);
  if (section) {
    return makeAutoField(row, section, { method: "section_anchor", key }, text);
  }
  if (key === "CALOPTIMA_FBA_TRANSITION_PLAN") {
    return null;
  }
  return null;
};

const calibrateDeterministicConfidence = (rowLabel: string, valueText: string, text: string): number => {
  const normalizedText = normalizeForContains(text);
  const normalizedValue = normalizeForContains(valueText);
  const normalizedLabel = normalizeForContains(rowLabel);
  const compactText = compactForContains(text);
  const compactLabel = compactForContains(rowLabel);
  const hasValueInText = normalizedValue.length >= 3 && normalizedText.includes(normalizedValue);
  const hasLabelInText =
    (normalizedLabel.length >= 3 && normalizedText.includes(normalizedLabel)) ||
    (compactLabel.length >= 3 && compactText.includes(compactLabel));

  let confidence = 0.88;
  if (hasValueInText) {
    confidence += 0.05;
  }
  if (hasLabelInText) {
    confidence += 0.03;
  }
  return clampConfidence(confidence);
};

const extractLineNearLabels = (
  text: string,
  labels: string[],
  stopLabels: string[] = [],
): { value: string; label: string } | null => {
  const normalizedText = compactDocumentText(text);
  for (const label of labels) {
    const direct = extractLineNearLabel(text, label, stopLabels);
    if (direct) {
      return { value: direct, label };
    }

    const normalizedMatch = normalizedText.match(new RegExp(`${flexibleLabelPattern(label)}\\s*[:\\-]?\\s*(.{2,320})`, "i"));
    if (normalizedMatch?.[1]) {
      const value = trimAtInlineBoundary(normalizedMatch[1], stopLabels);
      if (value) {
        return { value, label };
      }
    }
  }
  return null;
};

const deterministicValueForRow = (
  row: z.infer<typeof checklistRowSchema>,
  text: string,
  clientSnapshot?: z.infer<typeof requestSchema.shape.client_snapshot>,
  allRows?: Array<z.infer<typeof checklistRowSchema>>,
): ExtractedFieldResult => {
  const key = row.placeholder_key;
  const special = extractSpecialScalarByKey(row, text);
  if (special) {
    return special;
  }
  if (key === "CALOPTIMA_FBA_TRANSITION_PLAN") {
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
  }
  const labels = [row.label, ...(row.extraction_aliases ?? [])];
  const fromLabel = extractLineNearLabels(text, labels, collectStopLabels(labels, allRows));
  if (fromLabel) {
    const confidence = calibrateDeterministicConfidence(fromLabel.label, fromLabel.value, text);
    return {
      placeholder_key: key,
      value_text: fromLabel.value,
      value_json: null,
      confidence,
      mode: "AUTO",
      status: "drafted",
      source_span: { method: "label_regex", label: fromLabel.label },
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
    const goalMatch = line.match(
      /^(?:[A-Z]\.\s*)?(?:\d+\.\s*)?(child|parent\/caregiver|parent|target and replacement|target\/replacement|target behavior|replacement behavior|target|replacement|skill acquisition|caregiver)\s+goal\s*\d*\s*(?:\([^)]*\))?\s*[:-]\s*(.+)$/i,
    );
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
    { field_key: "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS", section_key: "service_recommendations", prefix: /^hcpcs\s*[:-]\s*(.+)$/i },
    { field_key: "CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE", section_key: "daily_schedules", prefix: /^daily activity schedule\s*[:-]\s*(.+)$/i },
    { field_key: "CALOPTIMA_FBA_SCHOOL_SCHEDULE", section_key: "daily_schedules", prefix: /^school schedule\s*[:-]\s*(.+)$/i },
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

const extractScheduleSections = (text: string): StructuredSectionResult[] => {
  const specs = [
    {
      field_key: "CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE",
      section_key: "daily_schedules",
      start: [/Daily\s+schedule\s+of\s+all\s+activities/i],
      end: [/IV\.\s+SCHOOL\s+INFORMATION/i, /Currently\s+being\s+assessed/i],
    },
    {
      field_key: "CALOPTIMA_FBA_SCHOOL_SCHEDULE",
      section_key: "daily_schedules",
      start: [/Daily\s+School\s+Schedule/i],
      end: [/\b1\.\s+Are\s+ABA\s+services/i, /Individualized\s+Educational\s+Plan\s+\(IEP\/equivalent\)\s+Information/i],
    },
  ] as const;

  return specs.flatMap((spec) => {
    const sectionText = extractSectionText(text, [...spec.start], [...spec.end]);
    if (!sectionText) {
      return [];
    }
    const rawText = normalizeExtractedValue(spec.start.reduce((current, pattern) => current.replace(pattern, ""), sectionText));
    if (rawText.length < 5) {
      return [];
    }
    return [{
      section_key: spec.section_key,
      field_key: spec.field_key,
      section_index: 0,
      payload: { rows: [{ raw_text: rawText }], raw_text: rawText },
      source_span: { method: "deterministic_schedule_section" },
      status: "drafted" as const,
      required: true,
      review_notes: "Deterministic schedule section extracted from CalOptima document text for manual table review.",
    }];
  });
};

const parseSignaturePayload = (rawText: string): Record<string, unknown> => {
  const compact = compactDocumentText(rawText);
  const writerMatch = compact.match(/Report\s+written\s+by:\s*(?:\([^)]*\)\s*)?(?:(?:BCa?BA\/BMA\s+or\s+)?BCBA\/BMC\s+professional\s+level\s*)?(.+?)(?=Title,\s+License\/Certificate|Date\s+of\s+Report\s+Completed|Signature:)/i);
  const writerTitleMatch = compact.match(/Title,\s+License\/Certificate\s+#:\s*(.+?)(?=Date\s+of\s+Report\s+Completed|Signature:|B\.\s+Report\s+reviewed\s+by:)/i);
  const completedDates = [...compact.matchAll(/Date\s+of\s+Report\s+Completed\s*:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})?/gi)]
    .map((match) => normalizeExtractedValue(match[1] ?? ""))
    .filter(Boolean);
  const signatureDates = [...compact.matchAll(/Signature:\s*(?:\*\*)?\s*Date:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})?/gi)]
    .map((match) => normalizeExtractedValue(match[1] ?? ""))
    .filter(Boolean);
  const reviewerMatch = compact.match(/Report\s+reviewed\s+by:\s*(?:\([^)]*\)\s*)?(?:BCBA\/BMC\s+professional\s+level\s*)?(.+?)(?=Title,\s+License\/Certificate|Date\s+of\s+Report\s+Completed|Signature:|$)/i);

  return {
    raw_text: rawText,
    written_by: writerMatch?.[1] ? normalizeExtractedValue(writerMatch[1]) : null,
    writer_title_license: writerTitleMatch?.[1] ? normalizeExtractedValue(writerTitleMatch[1]) : null,
    report_completed_date: completedDates[0] ?? null,
    writer_signature_date: signatureDates[0] ?? null,
    reviewed_by: reviewerMatch?.[1] ? normalizeExtractedValue(reviewerMatch[1]) : null,
    reviewer_completed_date: completedDates[1] ?? null,
    reviewer_signature_date: signatureDates[1] ?? null,
  };
};

const extractHcpcsRowsFromNarrative = (text: string): StructuredSectionResult[] => {
  const sectionText = extractSectionText(
    text,
    [/HCPCS\s+Code\s+and\s+Modifiers\s+Description/i],
    [/Telehealth\s+Consent\s+Confirmation/i, /XXI\.\s+PARENT\/CAREGIVER/i, /XVIII\.\s+SIGNATURES/i],
  );
  if (!sectionText) {
    return [];
  }
  const knownCodePattern = /\b(H0032-HN|H0032-HO|H2014-HQ|H2019|S5108|S5110)\b\s+([\s\S]*?)(?=\b(?:H0032-HN|H0032-HO|H2014-HQ|H2019|S5108|S5110)\b|Telehealth\s+Consent|$)/gi;
  const rows: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;
  while ((match = knownCodePattern.exec(sectionText)) !== null) {
    rows.push({
      hcpcs_code: match[1],
      raw_text: `${match[1]} ${match[2] ?? ""}`.replace(/\s+/g, " ").trim(),
    });
  }
  if (rows.length === 0) {
    rows.push({ raw_text: sectionText });
  }
  return [{
    section_key: "service_recommendations",
    field_key: "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
    section_index: 0,
    payload: { rows },
    source_span: { method: "deterministic_hcpcs_section", row_count: rows.length },
    status: "drafted",
    required: true,
    review_notes: "Deterministic HCPCS recommendation section extracted from CalOptima document text.",
  }];
};

const extractNarrativeStructuredSections = (text: string): StructuredSectionResult[] => {
  const specs = [
    {
      field_key: "CALOPTIMA_FBA_COORDINATION_OF_CARE",
      section_key: "coordination_of_care",
      start: [/IV\.\s+COORDINATION\s+OF\s+CARE/i],
      end: [/VII\.\s+ADAPTIVE\s+TESTING/i, /Vineland\s+Adaptive/i],
    },
    {
      field_key: "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES",
      section_key: "assessment_results",
      start: [/Vineland\s+Adaptive\s+Behavior\s+Scales/i, /Domain\s+Raw\s+Score\s+Standard\s+Score/i],
      end: [/IX\.\s+DIAGNOSTIC\s+INFORMATION/i, /X\.\s+FUNCTIONAL\s+ASSESSMENT/i],
    },
    {
      field_key: "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
      section_key: "diagnostic_behavior_analysis",
      start: [/X\.\s+FUNCTIONAL\s+ASSESSMENT\s+OR\s+ANALYSIS\s+OF\s+TARGET\s+BEHAVIORS/i],
      end: [/XI\.\s+BEHAVIOR\s+INTERVENTION\s+PLAN/i],
    },
    {
      field_key: "CALOPTIMA_FBA_BIP_BLOCKS",
      section_key: "diagnostic_behavior_analysis",
      start: [/XI\.\s+BEHAVIOR\s+INTERVENTION\s+PLAN/i],
      end: [
        /XII\.\s+/i,
        /XIII\.\s+/i,
        /XIV\.\s+TARGET\s+AND\s+REPLACEMENT\s+BEHAVIOR\s+GOALS/i,
        /XV\.\s+SKILL\s+ACQUISITION/i,
      ],
    },
    {
      field_key: "CALOPTIMA_FBA_SIGNATURES",
      section_key: "signatures",
      start: [/XVIII\.\s+SIGNATURES/i],
      end: [/\*\*\s+By\s+signing/i],
    },
  ] as const;

  return specs.flatMap((spec) => {
    const sectionText = extractSectionText(text, [...spec.start], [...spec.end]);
    if (!sectionText) {
      return [];
    }
    const payload = spec.field_key === "CALOPTIMA_FBA_SIGNATURES"
      ? parseSignaturePayload(sectionText)
      : { raw_text: sectionText };
    return [{
      section_key: spec.section_key,
      field_key: spec.field_key,
      section_index: 0,
      payload,
      source_span: { method: "deterministic_section_anchor", anchor_count: spec.start.length },
      status: "drafted" as const,
      required: true,
      review_notes: "Deterministic anchored section extracted from CalOptima document text.",
    }];
  });
};

const extractStructuredSections = (text: string): StructuredSectionResult[] => [
  ...extractNarrativeStructuredSections(text),
  ...extractStructuredGoalSections(text),
  ...extractStructuredTableSections(text),
  ...extractScheduleSections(text),
  ...extractHcpcsRowsFromNarrative(text),
].reduce<StructuredSectionResult[]>((deduped, section) => {
  const existingIndex = deduped.findIndex((existing) =>
    existing.field_key === section.field_key && existing.section_index === section.section_index
  );
  if (existingIndex === -1) {
    deduped.push(section);
    return deduped;
  }
  const existing = deduped[existingIndex];
  const existingRaw = typeof existing.payload.raw_text === "string" ? existing.payload.raw_text : "";
  const incomingRaw = typeof section.payload.raw_text === "string" ? section.payload.raw_text : "";
  if (incomingRaw.length > existingRaw.length) {
    deduped[existingIndex] = section;
  }
  return deduped;
}, []);

export const __TESTING__ = {
  deterministicValueForRow,
  extractStructuredSections,
};

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

    const deterministic = data.checklist_rows.map((row) =>
      deterministicValueForRow(row, documentText, data.client_snapshot, data.checklist_rows)
    );
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
